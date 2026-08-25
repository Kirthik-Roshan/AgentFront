import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const SAFE_INHERITED_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
] as const;

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowedEnvKeys?: readonly string[];
  redactValues?: readonly (string | undefined)[];
  timeoutMs?: number;
  terminationGraceMs?: number;
}

export function createRestrictedProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  additionalAllowedKeys: readonly string[] = [],
): NodeJS.ProcessEnv {
  const allowed = new Set<string>([...SAFE_INHERITED_ENVIRONMENT_KEYS, ...additionalAllowedKeys]);
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactSensitiveOutput(
  output: string,
  sensitiveValues: readonly (string | undefined)[] = [],
): string {
  let redacted = output;
  const values = [...new Set(sensitiveValues.filter((value): value is string => Boolean(value && value.length >= 4)))]
    .sort((left, right) => right.length - left.length);
  for (const value of values) {
    redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[REDACTED]");
  }
  redacted = redacted.replace(
    /((?:["']?[a-z0-9_-]*(?:api[_-]?key|token|secret|password|credential|authorization)[a-z0-9_-]*["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
    "$1[REDACTED]",
  );
  redacted = redacted.replace(/\b(Bearer|Token\s+token=)\s*[^\s,"'}]+/gi, "$1 [REDACTED]");
  return redacted;
}

export function runProcess(
  executable: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const environment = createRestrictedProcessEnvironment(options.env ?? process.env, options.allowedEnvKeys);
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceKill: NodeJS.Timeout | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), options.terminationGraceMs ?? 2_000);
      forceKill.unref();
    }, options.timeoutMs ?? 300_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-200_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-200_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (!settled) {
        settled = true;
        if (timedOut) {
          reject(new Error(`${executable} timed out after ${options.timeoutMs ?? 300_000}ms and was terminated.`));
          return;
        }
        resolve({
          exitCode: code ?? 1,
          stdout: redactSensitiveOutput(stdout, options.redactValues),
          stderr: redactSensitiveOutput(stderr, options.redactValues),
        });
      }
    });
  });
}
