import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "acorn";
import { validateProjectSpecification } from "@agentfront/scoring";
import type { BuildResult, ProjectSpecification, QACheck, QAResult, Requirements } from "@agentfront/types";

export interface QAInput {
  specification: ProjectSpecification;
  requirements: Requirements;
  build: BuildResult;
}

interface BuildArtifact {
  absolutePath: string;
  relativePath: string;
  size: number;
}

interface LocalReference {
  baseDirectory: string;
  value: string;
}

const FEATURE_INDICATORS: Record<string, RegExp> = {
  menu: /\bmenu\b/i,
  gallery: /\bgallery\b/i,
  whatsappOrdering: /whatsapp|wa\.me/i,
  googleMaps: /google\s*maps|mapslink|open in maps/i,
  reservations: /reserv(?:e|ation)/i,
  booking: /\bbook(?:ing)?\b/i,
  testimonials: /testimonial|review/i,
  catalog: /catalog|collection/i,
  emergencyContact: /emergency|urgent/i,
};

const isContainedPath = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

function collectArtifacts(root: string, directory = root): { files: BuildArtifact[]; symlinks: string[] } {
  const files: BuildArtifact[] = [];
  const symlinks: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ["node_modules", ".git"].includes(entry.name)) continue;
    const absolutePath = resolve(directory, entry.name);
    const relativePath = relative(root, absolutePath);
    if (entry.isSymbolicLink()) {
      symlinks.push(relativePath);
    } else if (entry.isDirectory()) {
      const nested = collectArtifacts(root, absolutePath);
      files.push(...nested.files);
      symlinks.push(...nested.symlinks);
    } else if (entry.isFile()) {
      const details = statSync(absolutePath);
      files.push({ absolutePath, relativePath, size: details.size });
    }
  }
  return { files, symlinks };
}

const normalizeReference = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("//")) return null;
  if (/^(?:https?:|mailto:|tel:|data:|blob:)/i.test(trimmed)) return null;
  return trimmed.split(/[?#]/, 1)[0] ?? null;
};

const resolveReference = (root: string, reference: LocalReference): string | null => {
  const normalized = normalizeReference(reference.value);
  if (!normalized) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    return "";
  }
  const candidate = decoded.startsWith("/")
    ? resolve(root, decoded.replace(/^[/\\]+/, ""))
    : resolve(reference.baseDirectory, decoded);
  return isContainedPath(root, candidate) ? candidate : "";
};

function inspectBuildArtifacts(buildPath: string, input: QAInput): QACheck[] {
  const root = resolve(buildPath);
  const directory = (() => {
    try {
      return statSync(root).isDirectory();
    } catch {
      return false;
    }
  })();
  if (!directory) {
    return [{
      name: "artifact-directory",
      passed: false,
      blocking: true,
      message: "The build output directory is missing.",
    }];
  }

  const artifacts = collectArtifacts(root);
  const byPath = new Map(artifacts.files.map((file) => [file.relativePath.replaceAll("\\", "/"), file]));
  const index = byPath.get("index.html");
  const indexHtml = index && index.size > 0 ? readFileSync(index.absolutePath, "utf8") : "";
  const textFiles = artifacts.files.filter((file) =>
    [".html", ".js", ".mjs", ".cjs", ".css", ".json"].includes(extname(file.relativePath).toLowerCase()) && file.size <= 1_000_000,
  );
  const text = new Map<string, string>();
  for (const file of textFiles) text.set(file.relativePath, readFileSync(file.absolutePath, "utf8"));

  const renderedContent = [...text.entries()]
    .filter(([path]) => path !== "project_spec.json" && path !== "qa-report.json")
    .map(([, content]) => content)
    .join("\n")
    .slice(0, 5_000_000);
  const references: LocalReference[] = [];
  for (const [path, content] of text) {
    const baseDirectory = dirname(resolve(root, path));
    if (extname(path).toLowerCase() === ".html") {
      references.push(...[...content.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
        .map((match) => ({ baseDirectory, value: match[1] ?? "" })));
    }
    if (extname(path).toLowerCase() === ".css") {
      references.push(...[...content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)]
        .map((match) => ({ baseDirectory, value: match[1] ?? "" })));
    }
    if (extname(path).toLowerCase() === ".js") {
      references.push(...[...content.matchAll(/fetch\(\s*["']([^"']+)["']/gi)]
        .map((match) => ({ baseDirectory, value: match[1] ?? "" })));
    }
  }

  const unsafeExecutableReferences = references.filter((reference) => /^javascript:/i.test(reference.value.trim()));
  const resolvedReferences = references
    .map((reference) => ({ reference, path: resolveReference(root, reference) }))
    .filter((item) => item.path !== null);
  const brokenReferences: string[] = [];
  for (const item of resolvedReferences) {
    if (!item.path) {
      brokenReferences.push(item.reference.value);
      continue;
    }
    const target: ReturnType<typeof statSync> | null = (() => {
      try {
        return statSync(item.path);
      } catch {
        return null;
      }
    })();
    if (!target || (!target.isDirectory() && target.size === 0)) brokenReferences.push(item.reference.value);
  }

  const malformedJson: string[] = [];
  for (const [path, content] of text) {
    if (extname(path).toLowerCase() !== ".json") continue;
    try {
      JSON.parse(content);
    } catch {
      malformedJson.push(path);
    }
  }

  const malformedJavaScript = artifacts.files
    .filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file.relativePath).toLowerCase()))
    .flatMap((file) => {
      const source = readFileSync(file.absolutePath, "utf8");
      const extension = extname(file.relativePath).toLowerCase();
      const sourceTypes = extension === ".mjs"
        ? (["module"] as const)
        : extension === ".cjs"
          ? (["script"] as const)
          : (["script", "module"] as const);
      const failures: string[] = [];
      for (const sourceType of sourceTypes) {
        try {
          parse(source, { ecmaVersion: "latest", sourceType, allowHashBang: true });
          return [];
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "syntax parse failed");
        }
      }
      return [`${file.relativePath} (${failures.at(-1)?.slice(0, 300) ?? "syntax parse failed"})`];
    });

  const missingPages = input.requirements.pages.filter((page) => {
    if (page.trim().toLowerCase() === "home") return !indexHtml;
    const slug = page.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (byPath.has(`${slug}.html`)) return false;
    const indicator = new RegExp(`(?:id|href)=["']#?${slug}["']|\\b${slug.replaceAll("-", "\\s+")}\\b`, "i");
    return !indicator.test(renderedContent);
  });
  const missingFeatures = Object.entries(input.requirements.features)
    .filter(([, enabled]) => enabled === true)
    .map(([feature]) => feature)
    .filter((feature) => !(FEATURE_INDICATORS[feature]?.test(renderedContent) ?? false));
  const validDocument =
    /<!doctype\s+html/i.test(indexHtml) &&
    /<html[\s>]/i.test(indexHtml) &&
    /<body[\s>]/i.test(indexHtml) &&
    /<main[\s>]/i.test(indexHtml) &&
    /<\/body>/i.test(indexHtml) &&
    /<\/html>/i.test(indexHtml);

  return [
    {
      name: "artifact-directory",
      passed: artifacts.files.length > 0,
      blocking: true,
      message: artifacts.files.length > 0 ? `${artifacts.files.length} build artifacts found.` : "The build output is empty.",
    },
    {
      name: "artifact-index",
      passed: Boolean(indexHtml.trim()),
      blocking: true,
      message: indexHtml.trim() ? "A non-empty index.html exists." : "A non-empty index.html is required.",
    },
    {
      name: "artifact-document-structure",
      passed: validDocument,
      blocking: true,
      message: validDocument ? "The entry document has the required HTML structure." : "index.html is structurally incomplete.",
    },
    {
      name: "artifact-required-pages",
      passed: missingPages.length === 0,
      blocking: true,
      message: missingPages.length === 0 ? "Required pages are represented in the build." : `Missing pages: ${missingPages.join(", ")}.`,
    },
    {
      name: "artifact-purchased-features",
      passed: missingFeatures.length === 0,
      blocking: true,
      message: missingFeatures.length === 0 ? "Purchased features are represented in the build." : `Missing features: ${missingFeatures.join(", ")}.`,
    },
    {
      name: "artifact-local-references",
      passed: brokenReferences.length === 0 && unsafeExecutableReferences.length === 0,
      blocking: true,
      message: brokenReferences.length === 0 && unsafeExecutableReferences.length === 0
        ? `${resolvedReferences.length} local references resolve.`
        : `Broken or unsafe references: ${[...brokenReferences, ...unsafeExecutableReferences.map((item) => item.value)].join(", ")}.`,
    },
    {
      name: "artifact-json",
      passed: malformedJson.length === 0,
      blocking: true,
      message: malformedJson.length === 0 ? "JSON artifacts parse successfully." : `Malformed JSON: ${malformedJson.join(", ")}.`,
    },
    {
      name: "artifact-javascript-syntax",
      passed: malformedJavaScript.length === 0,
      blocking: true,
      message: malformedJavaScript.length === 0
        ? "JavaScript artifacts parse successfully."
        : `Malformed JavaScript: ${malformedJavaScript.join(", ")}.`,
    },
    {
      name: "artifact-symlinks",
      passed: artifacts.symlinks.length === 0,
      blocking: true,
      message: artifacts.symlinks.length === 0 ? "Build artifacts contain no symbolic links." : `Symbolic links are not deployable: ${artifacts.symlinks.join(", ")}.`,
    },
  ];
}

export function runDeterministicQA(input: QAInput): QAResult {
  const schema = validateProjectSpecification(input.specification);
  const missingFeatures = Object.entries(input.requirements.features)
    .filter(([, enabled]) => enabled)
    .map(([feature]) => feature)
    .filter((feature) => input.specification.features[feature as keyof typeof input.specification.features] !== true);
  const serialized = JSON.stringify(input.specification).toLowerCase();

  const checks: QACheck[] = [
    {
      name: "production-build",
      passed: input.build.success,
      blocking: true,
      message: input.build.success ? "Production build completed." : "Production build failed.",
    },
    {
      name: "specification-schema",
      passed: schema.success,
      blocking: true,
      message: schema.success ? "Project specification is valid." : "Project specification is invalid.",
    },
    {
      name: "required-pages",
      passed: input.requirements.pages.every((page) => input.specification.pages.includes(page)),
      blocking: true,
      message: "All purchased pages must be represented.",
    },
    {
      name: "purchased-features",
      passed: missingFeatures.length === 0,
      blocking: true,
      message: missingFeatures.length === 0 ? "All purchased features are represented." : `Missing: ${missingFeatures.join(", ")}.`,
    },
    {
      name: "placeholder-content",
      passed: !/(lorem ipsum|todo|your business name|xxx+)/i.test(serialized),
      blocking: true,
      message: "Specification contains no obvious placeholder content.",
    },
    {
      name: "responsive-contract",
      passed: input.specification.design.mobileFirst === true,
      blocking: true,
      message: "The approved build contract is mobile-first.",
    },
    {
      name: "verified-contact",
      passed: input.specification.business.phone.trim().length >= 8,
      blocking: true,
      message: "A verified contact number is present.",
    },
    ...inspectBuildArtifacts(input.build.buildPath, input),
  ];
  const failed = checks.filter((check) => !check.passed);
  const score = Math.max(0, 100 - failed.length * 8);
  return { checks, score, passed: failed.every((check) => !check.blocking) };
}
