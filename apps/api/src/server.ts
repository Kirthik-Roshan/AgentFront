import { createServer } from "node:http";
import { createRouter } from "./router";
import { createRuntime } from "./runtime";

const runtime = createRuntime();
const host = process.env.HOST?.trim() || "127.0.0.1";
const server = createServer(createRouter(runtime, { environment: process.env, bindHost: host }));
const port = Number(process.env.PORT ?? 4_000);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("PORT must be a valid TCP port.");

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "agentfront-api", event: "server.started", host, port, timestamp: new Date().toISOString() })}\n`,
  );
});

const shutdown = (signal: string): void => {
  process.stdout.write(`${JSON.stringify({ level: "info", service: "agentfront-api", event: "server.stopping", signal, timestamp: new Date().toISOString() })}\n`);
  server.close(() => {
    void runtime.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

export { runtime, server };
