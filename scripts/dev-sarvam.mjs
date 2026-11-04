import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local quick-tunnel callbacks get an independent secret on every launch. The
// configured token remains available for stable production callback URLs, but
// a value copied into a screenshot or chat cannot authenticate this session.
const webhookToken = randomBytes(32).toString("hex");

const localCloudflared = fileURLToPath(new URL("../.agentfront-tools/cloudflared", import.meta.url));
const cloudflared = process.env.CLOUDFLARED_BIN?.trim() ||
  (existsSync(localCloudflared) ? localCloudflared : "cloudflared");
const relayPort = Number(process.env.SARVAM_RELAY_PORT ?? 4040);
if (!Number.isInteger(relayPort) || relayPort < 1 || relayPort > 65_535) {
  throw new Error("SARVAM_RELAY_PORT must be a valid port.");
}

const children = new Set();
let stopping = false;
let exitCode = 0;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    ...options,
  });
  children.add(child);
  // `spawn` failures such as ENOENT emit `error` + `close` without `exit`.
  // Track `close` so a missing tunnel binary cannot leave the launcher hung.
  child.once("close", () => children.delete(child));
  return child;
}

function stop(signal = "SIGTERM") {
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
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const relay = start(process.execPath, ["scripts/sarvam-webhook-relay.mjs"], {
  env: { ...process.env, SARVAM_WEBHOOK_TOKEN: webhookToken },
  stdio: "inherit",
});
relay.once("error", (error) => {
  process.stderr.write(`Unable to start the restricted Sarvam relay: ${error.message}\n`);
  exitCode = 1;
  stop();
});

const tunnel = start(cloudflared, [
  "tunnel",
  "--url", `http://127.0.0.1:${relayPort}`,
  "--no-autoupdate",
], { stdio: ["ignore", "pipe", "pipe"] });

let publicOrigin;
try {
  publicOrigin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for a TryCloudflare URL.")), 30_000);
    let buffer = "";
    const consume = (chunk, destination) => {
      destination.write(chunk);
      buffer = `${buffer}${String(chunk)}`.slice(-16_384);
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[0]);
    };
    tunnel.stdout.on("data", (chunk) => consume(chunk, process.stdout));
    tunnel.stderr.on("data", (chunk) => consume(chunk, process.stderr));
    tunnel.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(
        error.code === "ENOENT"
          ? "cloudflared is not installed. Install it, or set CLOUDFLARED_BIN to its executable path."
          : `Unable to start cloudflared: ${error.message}`,
      ));
    });
    tunnel.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited before creating a tunnel (${signal ?? code ?? "unknown"}).`));
    });
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unable to create the Sarvam callback tunnel."}\n`);
  exitCode = 1;
  stop();
}

if (!publicOrigin) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exitCode = exitCode || 1;
} else {

const webhookUrl = new URL("/api/webhooks/sarvam/outbound", publicOrigin);
webhookUrl.searchParams.set("token", webhookToken);
process.stdout.write(`\nSarvam callback tunnel ready at ${publicOrigin} (restricted relay; token hidden).\n`);
process.stdout.write("Starting AgentFront with the live callback injected for this process.\n\n");

const dev = start(process.execPath, ["scripts/dev.mjs"], {
  env: {
    ...process.env,
    SARVAM_WEBHOOK_TOKEN: webhookToken,
    SARVAM_OUTBOUND_WEBHOOK_URL: webhookUrl.toString(),
  },
  stdio: "inherit",
});
dev.once("error", (error) => {
  process.stderr.write(`Unable to start AgentFront: ${error.message}\n`);
  exitCode = 1;
  stop();
});
dev.once("exit", (code, signal) => {
  if (!stopping && (code !== 0 || signal)) exitCode = code ?? 1;
  stop();
});
tunnel.once("exit", (code, signal) => {
  if (!stopping) {
    process.stderr.write(`Sarvam tunnel stopped (${signal ?? code ?? "unknown"}); stopping AgentFront to prevent calls without callbacks.\n`);
    exitCode = code ?? 1;
    stop();
  }
});
relay.once("exit", (code, signal) => {
  if (!stopping) {
    process.stderr.write(`Sarvam relay stopped (${signal ?? code ?? "unknown"}); stopping AgentFront to prevent calls without callbacks.\n`);
    exitCode = code ?? 1;
    stop();
  }
});
}

await new Promise((resolve) => {
  const poll = setInterval(() => {
    if (children.size > 0) return;
    clearInterval(poll);
    resolve();
  }, 100);
});
process.exitCode = exitCode;
