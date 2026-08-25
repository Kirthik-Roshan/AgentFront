import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentEvent, BuildRequest, BuildResult, DeveloperProvider, IntegrationHealth } from "@agentfront/types";
import { runProcess } from "./process";

const WORKSPACE_OWNER_FILE = ".agentfront-workspace-owner.json";
const SAFE_TEMPLATE_TYPES = new Set(["restaurant", "salon", "garments", "mechanic"]);
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

interface WorkspaceOwnerManifest {
  schemaVersion: 1;
  project: {
    id: string;
    projectId: string;
  };
  leadId: string;
  business: {
    id: string;
    name: string;
    type: string;
    location: string;
    phone: string;
  };
  templateType: string;
}

const validateProjectId = (projectId: string): void => {
  if (!/^AF-\d{4}-\d{6}$/.test(projectId)) throw new Error("Unsafe project identifier.");
};

const ensureContainedPath = (root: string, child: string): void => {
  const path = relative(resolve(root), resolve(child));
  if (path.startsWith(`..${sep}`) || path === ".." || isAbsolute(path)) {
    throw new Error("Generated project path escaped its approved workspace root.");
  }
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

const isAlreadyPresent = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";

const makeOwnerManifest = (request: BuildRequest): WorkspaceOwnerManifest => ({
  schemaVersion: 1,
  project: {
    id: request.project.id,
    projectId: request.project.projectId,
  },
  leadId: request.project.leadId,
  business: {
    id: request.businessId,
    name: request.specification.business.name,
    type: request.specification.business.type,
    location: request.specification.business.location,
    phone: request.specification.business.phone,
  },
  templateType: request.project.templateType,
});

const serializeOwnerManifest = (manifest: WorkspaceOwnerManifest): string => `${JSON.stringify(manifest, null, 2)}\n`;

const ownerManifestsMatch = (actual: unknown, expected: WorkspaceOwnerManifest): boolean => {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const candidate = actual as Partial<WorkspaceOwnerManifest>;
  const project = candidate.project;
  const business = candidate.business;
  return (
    candidate.schemaVersion === expected.schemaVersion &&
    project?.id === expected.project.id &&
    project.projectId === expected.project.projectId &&
    candidate.leadId === expected.leadId &&
    business?.id === expected.business.id &&
    business.name === expected.business.name &&
    business.type === expected.business.type &&
    business.location === expected.business.location &&
    business.phone === expected.business.phone &&
    candidate.templateType === expected.templateType
  );
};

async function assertDirectoryWithoutSymlink(path: string, label: string): Promise<string> {
  const information = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) throw new Error(`${label} is missing.`);
    throw error;
  });
  if (information.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  if (!information.isDirectory()) throw new Error(`${label} must be a directory.`);
  return realpath(path);
}

async function assertContainedDirectory(root: string, path: string, label: string): Promise<string> {
  ensureContainedPath(root, path);
  const realPath = await assertDirectoryWithoutSymlink(path, label);
  ensureContainedPath(root, realPath);
  return realPath;
}

async function assertSafeTree(root: string, current = root): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    ensureContainedPath(root, path);
    const information = await lstat(path);
    if (information.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in generated workspaces: ${relative(root, path)}.`);
    }
    const resolvedPath = await realpath(path);
    ensureContainedPath(root, resolvedPath);
    if (information.isDirectory()) {
      await assertSafeTree(root, resolvedPath);
    } else if (!information.isFile()) {
      throw new Error(`Only regular files and directories are allowed in generated workspaces: ${relative(root, path)}.`);
    }
  }
}

async function assertSafeTemplate(template: string): Promise<void> {
  await assertSafeTree(template);
  const reservedManifest = resolve(template, WORKSPACE_OWNER_FILE);
  const reservedExists = await lstat(reservedManifest).then(() => true).catch((error: unknown) => {
    if (isMissing(error)) return false;
    throw error;
  });
  if (reservedExists) throw new Error(`Template must not contain the reserved ${WORKSPACE_OWNER_FILE} file.`);
}

async function copyRegularFile(source: string, destination: string): Promise<void> {
  const sourceHandle = await open(source, constants.O_RDONLY | NO_FOLLOW);
  try {
    const sourceInformation = await sourceHandle.stat();
    if (!sourceInformation.isFile()) throw new Error(`Template source is not a regular file: ${source}.`);
    const destinationHandle = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      sourceInformation.mode & 0o777,
    );
    try {
      await destinationHandle.writeFile(await sourceHandle.readFile());
      await destinationHandle.sync();
    } finally {
      await destinationHandle.close();
    }
  } finally {
    await sourceHandle.close();
  }
}

async function copyTemplateTree(sourceRoot: string, destinationRoot: string, current = sourceRoot): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const source = resolve(current, entry.name);
    const relativePath = relative(sourceRoot, source);
    const destination = resolve(destinationRoot, relativePath);
    ensureContainedPath(sourceRoot, source);
    ensureContainedPath(destinationRoot, destination);
    const information = await lstat(source);
    if (information.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in templates: ${relativePath}.`);
    }
    const realSource = await realpath(source);
    ensureContainedPath(sourceRoot, realSource);
    if (information.isDirectory()) {
      await mkdir(destination, { mode: information.mode & 0o777 });
      await copyTemplateTree(sourceRoot, destinationRoot, realSource);
    } else if (information.isFile()) {
      await copyRegularFile(realSource, destination);
    } else {
      throw new Error(`Only regular files and directories are allowed in templates: ${relativePath}.`);
    }
  }
}

async function assertSafeWritableFile(handle: Awaited<ReturnType<typeof open>>, label: string): Promise<void> {
  const information = await handle.stat();
  if (!information.isFile() || information.nlink !== 1) {
    throw new Error(`${label} must be a regular, unlinked workspace file.`);
  }
}

async function writeBufferAtStart(handle: Awaited<ReturnType<typeof open>>, contents: Buffer): Promise<void> {
  let offset = 0;
  while (offset < contents.length) {
    const result = await handle.write(contents, offset, contents.length - offset, offset);
    if (result.bytesWritten === 0) throw new Error("Unable to write generated workspace file.");
    offset += result.bytesWritten;
  }
  await handle.truncate(contents.length);
  await handle.sync();
}

async function safelyWriteWorkspaceFile(root: string, fileName: string, contents: string): Promise<void> {
  const path = resolve(root, fileName);
  ensureContainedPath(root, path);
  const parent = await realpath(dirname(path));
  ensureContainedPath(root, parent);
  if (parent !== root) throw new Error(`Workspace file ${fileName} must be written at the workspace root.`);
  const handle = await open(path, constants.O_RDWR | constants.O_CREAT | NO_FOLLOW, 0o600);
  try {
    await assertSafeWritableFile(handle, `Workspace file ${fileName}`);
    await writeBufferAtStart(handle, Buffer.from(contents, "utf8"));
  } finally {
    await handle.close();
  }
}

async function safelyReadOwnerManifest(root: string): Promise<WorkspaceOwnerManifest | null> {
  const manifestPath = resolve(root, WORKSPACE_OWNER_FILE);
  ensureContainedPath(root, manifestPath);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(manifestPath, constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  try {
    await assertSafeWritableFile(handle, "Workspace ownership manifest");
    const source = await handle.readFile("utf8");
    try {
      return JSON.parse(source) as WorkspaceOwnerManifest;
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

async function safelyCreateOwnerManifest(root: string, manifest: WorkspaceOwnerManifest): Promise<void> {
  const manifestPath = resolve(root, WORKSPACE_OWNER_FILE);
  ensureContainedPath(root, manifestPath);
  const handle = await open(
    manifestPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
    0o400,
  );
  try {
    await handle.writeFile(serializeOwnerManifest(manifest), "utf8");
    await handle.sync();
    await handle.chmod(0o400);
  } finally {
    await handle.close();
  }
}

async function initializeWorkspace(
  outputRoot: string,
  target: string,
  template: string,
  request: BuildRequest,
  manifest: WorkspaceOwnerManifest,
): Promise<boolean> {
  ensureContainedPath(outputRoot, target);
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (isAlreadyPresent(error)) return false;
    throw error;
  }
  const realTarget = await assertContainedDirectory(outputRoot, target, "Generated project workspace");
  await copyTemplateTree(template, realTarget);
  await assertSafeTree(realTarget);
  await safelyWriteWorkspaceFile(realTarget, "project_spec.json", `${JSON.stringify(request.specification, null, 2)}\n`);
  await safelyCreateOwnerManifest(realTarget, manifest);
  return true;
}

async function prepareWorkspace(request: BuildRequest): Promise<string> {
  validateProjectId(request.project.projectId);
  if (!request.project.id.trim() || !request.project.leadId.trim() || !request.businessId.trim()) {
    throw new Error("Project, lead and business identifiers are required for workspace ownership.");
  }
  if (request.specification.projectId !== request.project.projectId) {
    throw new Error("Project specification identifier does not match the requested project.");
  }
  if (
    request.specification.business.type !== request.project.templateType ||
    !SAFE_TEMPLATE_TYPES.has(request.project.templateType)
  ) {
    throw new Error("Project template does not match the approved business type.");
  }

  const requestedOutputRoot = resolve(request.outputRoot);
  await mkdir(requestedOutputRoot, { recursive: true, mode: 0o700 });
  const outputRoot = await assertDirectoryWithoutSymlink(requestedOutputRoot, "Generated project output root");

  const requestedTemplateRoot = resolve(request.templateRoot);
  const templateRoot = await assertDirectoryWithoutSymlink(requestedTemplateRoot, "Template root");
  const requestedTemplate = resolve(templateRoot, request.project.templateType);
  ensureContainedPath(templateRoot, requestedTemplate);
  const template = await assertContainedDirectory(templateRoot, requestedTemplate, `Template ${request.project.templateType}`);
  await assertSafeTemplate(template);

  const manifest = makeOwnerManifest(request);
  const ownerDigest = createHash("sha256").update(serializeOwnerManifest(manifest)).digest("hex").slice(0, 16);
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const workspaceName =
      attempt === 0
        ? request.project.projectId
        : `${request.project.projectId}--${ownerDigest}${attempt === 1 ? "" : `-${attempt}`}`;
    const target = resolve(outputRoot, workspaceName);
    ensureContainedPath(outputRoot, target);
    let information;
    try {
      information = await lstat(target);
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (await initializeWorkspace(outputRoot, target, template, request, manifest)) return realpath(target);
      continue;
    }
    if (information.isSymbolicLink()) throw new Error("Generated project workspace must not be a symbolic link.");
    if (!information.isDirectory()) continue;
    const realTarget = await assertContainedDirectory(outputRoot, target, "Generated project workspace");
    const actualManifest = await safelyReadOwnerManifest(realTarget);
    if (!ownerManifestsMatch(actualManifest, manifest)) continue;
    await assertSafeTree(realTarget);
    await safelyWriteWorkspaceFile(realTarget, "project_spec.json", `${JSON.stringify(request.specification, null, 2)}\n`);
    return realTarget;
  }
  throw new Error("Unable to allocate an isolated generated project workspace.");
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

async function customizeDemoConfiguration(target: string, request: BuildRequest): Promise<void> {
  const configPath = resolve(target, "business.config.json");
  ensureContainedPath(target, configPath);
  const parent = await realpath(dirname(configPath));
  ensureContainedPath(target, parent);
  if (parent !== target) throw new Error("Business configuration must be stored at the workspace root.");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(configPath, constants.O_RDWR | NO_FOLLOW);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  try {
    await assertSafeWritableFile(handle, "Business configuration");
    const source = await handle.readFile("utf8");
    const config = asObject(JSON.parse(source) as unknown);
    const business = asObject(config.business);
    const meta = asObject(config.meta);
    const hero = asObject(config.hero);
    const phone = request.specification.business.phone;
    const phoneTarget = phone.replace(/[^+\d]/g, "");
    const whatsappTarget = phone.replace(/\D/g, "");
    const location = request.specification.business.location;

    Object.assign(meta, {
      preview: false,
      previewLabel: "AgentFront demo delivery",
      projectId: request.specification.projectId,
    });
    Object.assign(business, {
      name: request.specification.business.name,
      location,
      phoneDisplay: phone,
      phoneLink: `tel:${phoneTarget}`,
      whatsappLink: request.specification.features.whatsappOrdering ? `https://wa.me/${whatsappTarget}` : "",
      mapsLink: request.specification.features.googleMaps
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
        : "",
    });
    Object.assign(hero, {
      title: `Welcome to ${request.specification.business.name}.`,
      description: `Find ${request.specification.business.name} in ${location} and contact the business directly.`,
    });
    config.meta = meta;
    config.business = business;
    config.hero = hero;
    config.features = { ...asObject(config.features), ...request.specification.features };

    if (request.specification.business.type === "restaurant") {
      config.about = {
        eyebrow: "About the restaurant",
        title: `${request.specification.business.name}, now easier to find online.`,
        body: `Explore verified contact and location details for ${request.specification.business.name}.`,
        facts: [
          { value: "01", label: "Mobile-first" },
          { value: "02", label: "Direct WhatsApp" },
          { value: "03", label: "Maps ready" },
        ],
      };
      config.menu = {
        note: `Contact ${request.specification.business.name} for the current menu, availability and verified prices.`,
        categories: [
          {
            name: "Current menu",
            items: [
              {
                name: "Ask for today’s menu",
                description: "Use the verified phone or WhatsApp contact below.",
                price: "Contact restaurant",
              },
            ],
          },
        ],
      };
      config.offers = [];
      config.gallery = [
        { title: request.specification.business.name, caption: "Restaurant information", tone: "saffron" },
        { title: "Visit in person", caption: location, tone: "forest" },
        { title: "Order directly", caption: "Use the verified contact details", tone: "clay" },
      ];
      config.hours = [{ days: "Opening hours", time: "Contact the restaurant for current hours" }];
      config.features = { ...asObject(config.features), offers: false };
    }

    await writeBufferAtStart(handle, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  } finally {
    await handle.close();
  }
}

const makeEvent = (request: BuildRequest, sequence: number, message: string): AgentEvent => ({
  id: `provider-event-${request.project.projectId}-${sequence}`,
  leadId: request.project.leadId,
  projectId: request.project.projectId,
  campaignId: null,
  agentType: "DEVELOPER",
  eventType: "build.progress",
  message,
  metadata: {},
  status: "INFO",
  durationMs: null,
  createdAt: new Date().toISOString(),
});

export class DemoDeveloperProvider implements DeveloperProvider {
  readonly name = "AgentFront Demo Developer";
  readonly mode = "DEMO" as const;

  async build(request: BuildRequest, onEvent?: (event: AgentEvent) => void): Promise<BuildResult> {
    const target = await prepareWorkspace(request);
    await customizeDemoConfiguration(target, request);
    const logs = [
      "Ownership-verified template workspace prepared",
      "Approved project_spec.json loaded",
      "Configuration-driven customization applied",
      "Production build simulated successfully (DEMO)",
    ];
    logs.forEach((message, index) => onEvent?.(makeEvent(request, index + 1, message)));
    return { buildPath: target, logs, success: true, mode: this.mode };
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "developer",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: "Safe workspace preparation and simulated build logs are active.",
      checkedAt: new Date().toISOString(),
    };
  }
}

export class CodexCLIProvider implements DeveloperProvider {
  readonly name = "Codex CLI";
  readonly mode = "REAL" as const;

  constructor(private readonly executable = "codex") {}

  async build(request: BuildRequest, onEvent?: (event: AgentEvent) => void): Promise<BuildResult> {
    const target = await prepareWorkspace(request);
    const instruction = [
      "You are AgentFront's Developer Agent.",
      "Read project_spec.json in the current directory and customize the existing template.",
      "Implement only purchased features, preserve responsive behavior, and use only verified business data from the spec.",
      "Run the production build and fix build errors. Do not access files outside this workspace.",
    ].join(" ");
    onEvent?.(makeEvent(request, 1, "Codex Developer Agent started in the isolated project workspace"));
    const result = await runProcess(
      this.executable,
      ["exec", "--sandbox", "workspace-write", "--cd", target, "--ephemeral", "--json", instruction],
      {
      cwd: target,
      timeoutMs: 15 * 60_000,
      },
    );
    const logs = [...result.stdout.split("\n"), ...result.stderr.split("\n")].filter(Boolean).slice(-1_000);
    logs.forEach((message, index) => onEvent?.(makeEvent(request, index + 2, message)));
    return { buildPath: target, logs, success: result.exitCode === 0, mode: this.mode };
  }

  async health(): Promise<IntegrationHealth> {
    try {
      await access(this.executable, constants.X_OK);
    } catch {
      const result = await runProcess(this.executable, ["--version"], { timeoutMs: 5_000 }).catch(() => null);
      if (!result || result.exitCode !== 0) {
        return {
          integration: "developer",
          provider: this.name,
          mode: this.mode,
          status: "NOT_CONFIGURED",
          message: "Codex CLI is not available; select the demo provider.",
          checkedAt: new Date().toISOString(),
        };
      }
    }
    return {
      integration: "developer",
      provider: this.name,
      mode: this.mode,
      status: "CONNECTED",
      message: "Codex CLI is available.",
      checkedAt: new Date().toISOString(),
    };
  }
}
