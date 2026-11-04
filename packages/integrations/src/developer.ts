import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentEvent, BuildRequest, BuildResult, DeveloperProvider, IntegrationHealth } from "@agentfront/types";
import { runProcess } from "./process";

const WORKSPACE_OWNER_FILE = ".agentfront-workspace-owner.json";
const SAFE_TEMPLATE_TYPES = new Set(["restaurant", "salon", "garments", "mechanic", "clinic", "education", "realestate", "fitness", "bakery", "legal"]);
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

export interface ClaudeDeveloperProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}

interface ClaudeToolResponse {
  content?: Array<{
    type?: string;
    name?: string;
    input?: { configuration_json?: unknown; summary?: unknown };
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const CLAUDE_CONFIGURATION_TOOL = "write_business_configuration";
const MAX_CLAUDE_CONFIGURATION_BYTES = 128_000;

async function readWorkspaceConfiguration(target: string): Promise<Record<string, unknown>> {
  const path = resolve(target, "business.config.json");
  ensureContainedPath(target, path);
  const parent = await realpath(dirname(path));
  if (parent !== target) throw new Error("Business configuration must be stored at the workspace root.");
  const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
  try {
    await assertSafeWritableFile(handle, "Business configuration");
    const source = await handle.readFile("utf8");
    if (Buffer.byteLength(source) > MAX_CLAUDE_CONFIGURATION_BYTES) {
      throw new Error("Business configuration exceeds the Claude customization limit.");
    }
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Business configuration must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

function assertSafeClaudeConfiguration(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("Claude configuration is too deeply nested.");
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > 20_000) throw new Error("Claude configuration contains an oversized string.");
    if (/<\s*script\b|javascript\s*:/i.test(value)) throw new Error("Claude configuration contains executable content.");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error("Claude configuration contains an oversized array.");
    value.forEach((item) => assertSafeClaudeConfiguration(item, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") throw new Error("Claude configuration contains an unsupported value.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 200) throw new Error("Claude configuration contains too many fields.");
  for (const [key, item] of entries) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw new Error("Claude configuration contains an unsafe field name.");
    }
    assertSafeClaudeConfiguration(item, depth + 1);
  }
}

function configurationValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function assertClaudeConfigurationShape(
  baseline: unknown,
  candidate: unknown,
  path = "business.config.json",
): void {
  const expectedType = configurationValueType(baseline);
  const actualType = configurationValueType(candidate);
  if (actualType !== expectedType) {
    throw new Error(`Claude configuration schema mismatch at ${path}: expected ${expectedType}, received ${actualType}.`);
  }

  if (Array.isArray(baseline)) {
    const candidateItems = candidate as unknown[];
    if (baseline.length === 0) {
      if (candidateItems.length > 0) {
        throw new Error(
          `Claude configuration schema mismatch at ${path}[0]: the baseline has no item schema for this array.`,
        );
      }
      return;
    }
    for (const [index, item] of candidateItems.entries()) {
      const failures: Error[] = [];
      let matched = false;
      for (const exemplar of baseline) {
        try {
          assertClaudeConfigurationShape(exemplar, item, `${path}[${index}]`);
          matched = true;
          break;
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (!matched) throw failures[0] ?? new Error(`Claude configuration schema mismatch at ${path}[${index}].`);
    }
    return;
  }

  if (!baseline || typeof baseline !== "object") return;
  const baselineRecord = baseline as Record<string, unknown>;
  const candidateRecord = candidate as Record<string, unknown>;
  for (const key of Object.keys(baselineRecord)) {
    if (!Object.hasOwn(candidateRecord, key)) {
      throw new Error(`Claude configuration schema mismatch at ${path}.${key}: missing required field.`);
    }
  }
  for (const key of Object.keys(candidateRecord)) {
    if (!Object.hasOwn(baselineRecord, key)) {
      throw new Error(`Claude configuration schema mismatch at ${path}.${key}: unsupported field.`);
    }
    assertClaudeConfigurationShape(baselineRecord[key], candidateRecord[key], `${path}.${key}`);
  }
}

function mergeClaudeConfiguration(
  baseline: Record<string, unknown>,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  assertSafeClaudeConfiguration(generated);
  assertClaudeConfigurationShape(baseline, generated);
  // Provider output may shape approved copy and presentation, but deterministic
  // code remains authoritative for identity, contact routes and paid features.
  return {
    ...baseline,
    ...generated,
    meta: baseline.meta,
    business: baseline.business,
    features: baseline.features,
  };
}

function boundedClaudeError(source: string): string {
  return source
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;}]+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}

/**
 * Claude is deliberately limited to one existing template configuration file.
 * Repository creation, QA and deployment remain deterministic provider steps.
 */
export class ClaudeDeveloperProvider implements DeveloperProvider {
  readonly name = "Claude Template Customizer";
  readonly mode = "REAL" as const;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;

  constructor(options: ClaudeDeveloperProviderOptions) {
    this.#apiKey = options.apiKey.trim();
    this.#model = options.model?.trim() || "claude-sonnet-4-6";
    this.#fetch = options.fetch ?? fetch;
    if (!this.#apiKey) throw new Error("ANTHROPIC_API_KEY is required for the Claude developer provider.");
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(this.#model)) throw new Error("CLAUDE_MODEL is invalid.");
  }

  async build(request: BuildRequest, onEvent?: (event: AgentEvent) => void): Promise<BuildResult> {
    const target = await prepareWorkspace(request);
    // Establish verified identity/contact fields before any model-authored copy.
    await customizeDemoConfiguration(target, request);
    const baseline = await readWorkspaceConfiguration(target);
    onEvent?.(makeEvent(request, 1, "Claude received the approved client brief and existing template configuration"));
    const response = await this.#fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.#apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.#model,
        max_tokens: 8_192,
        system: [
          "You customize an existing AgentFront website template; you never build a new application.",
          "Return the complete business.config.json through the required tool.",
          "Preserve its schema and top-level keys. Use only facts in project_spec and current_config.",
          "Do not invent services, prices, testimonials, addresses, offers, URLs, or contact details.",
          "Keep copy concise, production-ready and appropriate for the requested business style.",
        ].join(" "),
        messages: [{
          role: "user",
          content: JSON.stringify({ project_spec: request.specification, current_config: baseline }),
        }],
        tools: [{
          name: CLAUDE_CONFIGURATION_TOOL,
          description: "Write the complete customized business.config.json for the selected existing template.",
          input_schema: {
            type: "object",
            properties: {
              configuration_json: { type: "string", description: "The complete valid JSON configuration object." },
              summary: { type: "string", description: "One short sentence describing the bounded customization." },
            },
            required: ["configuration_json", "summary"],
            additionalProperties: false,
          },
        }],
        tool_choice: { type: "tool", name: CLAUDE_CONFIGURATION_TOOL },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Claude Messages API failed (${response.status}): ${boundedClaudeError(body)}`);
    let payload: ClaudeToolResponse;
    try {
      payload = JSON.parse(body) as ClaudeToolResponse;
    } catch {
      throw new Error("Claude Messages API returned invalid JSON.");
    }
    const toolUse = payload.content?.find((item) => item.type === "tool_use" && item.name === CLAUDE_CONFIGURATION_TOOL);
    const configurationSource = toolUse?.input?.configuration_json;
    if (typeof configurationSource !== "string" || !configurationSource.trim()) {
      throw new Error("Claude did not return the required template configuration tool result.");
    }
    if (Buffer.byteLength(configurationSource) > MAX_CLAUDE_CONFIGURATION_BYTES) {
      throw new Error("Claude returned an oversized template configuration.");
    }
    let generated: unknown;
    try {
      generated = JSON.parse(configurationSource) as unknown;
    } catch {
      throw new Error("Claude returned a malformed template configuration.");
    }
    if (!generated || typeof generated !== "object" || Array.isArray(generated)) {
      throw new Error("Claude template configuration must be an object.");
    }
    const configuration = mergeClaudeConfiguration(baseline, generated as Record<string, unknown>);
    await safelyWriteWorkspaceFile(target, "business.config.json", `${JSON.stringify(configuration, null, 2)}\n`);
    onEvent?.(makeEvent(request, 2, "Claude customization applied to the existing template configuration"));
    const usage = payload.usage;
    const logs = [
      `Claude model ${this.#model} customized business.config.json`,
      `Claude usage: ${usage?.input_tokens ?? "unknown"} input / ${usage?.output_tokens ?? "unknown"} output tokens`,
      "Verified identity, contact routes and purchased feature flags were preserved deterministically",
    ];
    return { buildPath: target, logs, success: true, mode: this.mode };
  }

  async health(): Promise<IntegrationHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await this.#fetch(
        `https://api.anthropic.com/v1/models/${encodeURIComponent(this.#model)}`,
        {
          method: "GET",
          headers: {
            "X-API-Key": this.#apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error("Claude model access check failed.");
      const body = await response.text();
      if (Buffer.byteLength(body) > 64_000) throw new Error("Claude model response was oversized.");
      const model = JSON.parse(body) as unknown;
      if (!model || typeof model !== "object" || Array.isArray(model) ||
          (model as Record<string, unknown>).id !== this.#model) {
        throw new Error("Claude model response was invalid.");
      }
      return {
        integration: "developer",
        provider: this.name,
        mode: this.mode,
        status: "CONNECTED",
        message: `Claude ${this.#model} is authenticated for bounded existing-template customization.`,
        checkedAt,
      };
    } catch {
      return {
        integration: "developer",
        provider: this.name,
        mode: this.mode,
        status: "DEGRADED",
        message: `Claude ${this.#model} is configured, but its API key/model access could not be verified.`,
        checkedAt,
      };
    }
  }
}


export interface OpenAIDeveloperProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}

interface OpenAIResponsesPayload {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function openAIOutputText(payload: OpenAIResponsesPayload): string {
  return (payload.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text!.trim()).filter(Boolean).join("\n");
}

/**
 * OpenAI is restricted to the selected template's configuration JSON. The
 * deterministic pipeline still owns workspace creation, protected identity
 * fields, validation, QA and deployment.
 */
export class OpenAIDeveloperProvider implements DeveloperProvider {
  readonly name = "OpenAI Template Customizer";
  readonly mode = "REAL" as const;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAIDeveloperProviderOptions) {
    this.#apiKey = options.apiKey.trim();
    this.#model = options.model?.trim() || "gpt-6-astra";
    this.#fetch = options.fetch ?? fetch;
    if (!this.#apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI developer provider.");
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(this.#model)) throw new Error("OPENAI_MODEL is invalid.");
  }

  async build(request: BuildRequest, onEvent?: (event: AgentEvent) => void): Promise<BuildResult> {
    const target = await prepareWorkspace(request);
    await customizeDemoConfiguration(target, request);
    const baseline = await readWorkspaceConfiguration(target);
    onEvent?.(makeEvent(request, 1, "OpenAI received the approved client brief and existing template configuration"));
    const response = await this.#fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiKey}` },
      body: JSON.stringify({
        model: this.#model,
        store: false,
        max_output_tokens: 8192,
        instructions: [
          "Customize only the supplied existing AgentFront website template configuration.",
          "Return one complete JSON object and no markdown.",
          "Preserve every existing key and value type. Use only facts in project_spec and current_config.",
          "Do not invent services, prices, testimonials, addresses, offers, URLs, or contact details.",
          "Keep copy concise, production-ready, responsive and appropriate for the requested business style."
        ].join(" "),
        input: JSON.stringify({ project_spec: request.specification, current_config: baseline }),
        text: { format: { type: "json_object" } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`OpenAI Responses API failed (${response.status}): ${boundedClaudeError(body)}`);
    let payload: OpenAIResponsesPayload;
    try { payload = JSON.parse(body); } catch { throw new Error("OpenAI Responses API returned invalid JSON."); }
    const configurationSource = openAIOutputText(payload);
    if (!configurationSource) throw new Error("OpenAI did not return the required template configuration.");
    if (Buffer.byteLength(configurationSource) > MAX_CLAUDE_CONFIGURATION_BYTES) {
      throw new Error("OpenAI returned an oversized template configuration.");
    }
    let generated: unknown;
    try { generated = JSON.parse(configurationSource); } catch { throw new Error("OpenAI returned malformed template configuration JSON."); }
    if (!generated || typeof generated !== "object" || Array.isArray(generated)) {
      throw new Error("OpenAI template configuration must be an object.");
    }
    const configuration = mergeClaudeConfiguration(baseline, generated as Record<string, unknown>);
    await safelyWriteWorkspaceFile(target, "business.config.json", `${JSON.stringify(configuration, null, 2)}\n`);
    onEvent?.(makeEvent(request, 2, "OpenAI customization applied to the existing template configuration"));
    const logs = [
      `OpenAI model ${this.#model} customized business.config.json`,
      `OpenAI usage: ${payload.usage?.input_tokens ?? "unknown"} input / ${payload.usage?.output_tokens ?? "unknown"} output tokens`,
      "Verified identity, contact routes and purchased feature flags were preserved deterministically",
    ];
    return { buildPath: target, logs, success: true, mode: this.mode };
  }

  async health(): Promise<IntegrationHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await this.#fetch(`https://api.openai.com/v1/models/${encodeURIComponent(this.#model)}`, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("OpenAI model access check failed.");
      const body = await response.text();
      if (Buffer.byteLength(body) > 64_000) throw new Error("OpenAI model response was oversized.");
      const model = JSON.parse(body) as unknown;
      if (!model || typeof model !== "object" || Array.isArray(model) ||
          (model as Record<string, unknown>).id !== this.#model) throw new Error("OpenAI model response was invalid.");
      return { integration: "developer", provider: this.name, mode: this.mode, status: "CONNECTED",
        message: `OpenAI ${this.#model} is authenticated for bounded existing-template customization.`, checkedAt };
    } catch {
      return { integration: "developer", provider: this.name, mode: this.mode, status: "DEGRADED",
        message: `OpenAI ${this.#model} is configured, but API key/model access could not be verified.`, checkedAt };
    }
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
