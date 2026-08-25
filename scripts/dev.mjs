import { spawn } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = ["dev:api", "dev:web"];
const children = commands.map((script) => spawn(npmExecutable, ["run", script], {
  env: process.env,
  shell: false,
  stdio: "inherit",
}));

let stopping = false;
let exitCode = 0;

const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  const forceTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5_000);
  forceTimer.unref();
};

for (const child of children) {
  child.once("error", (error) => {
    process.stderr.write(`Unable to start an AgentFront development service: ${error.message}\n`);
    exitCode = 1;
    stop("SIGTERM");
  });
  child.once("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) {
      exitCode = code ?? 1;
      stop("SIGTERM");
    }
    if (children.every((candidate) => candidate.exitCode !== null || candidate.signalCode !== null)) {
      process.exitCode = exitCode;
    }
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
