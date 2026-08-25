import { IdempotentWorkerQueue } from "./queue";

// The local API runs demo work in-process so it can share its ephemeral store.
// Production wiring supplies a Redis-backed handler while retaining this idempotent job contract.
export const queue = new IdempotentWorkerQueue(async (job) => {
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "agentfront-worker", event: "job.received", jobId: job.id, leadId: job.leadId, timestamp: new Date().toISOString() })}\n`,
  );
});

if (process.env.WORKER_BOOT_LOG !== "false") {
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "agentfront-worker", event: "worker.ready", queue: "local-idempotent", redisUrlConfigured: Boolean(process.env.REDIS_URL), timestamp: new Date().toISOString() })}\n`,
  );
}

const poller = setInterval(() => {
  void queue.drain((result) => {
    process.stdout.write(
      `${JSON.stringify({ level: result.status === "FAILED" ? "error" : "info", service: "agentfront-worker", event: `job.${result.status.toLowerCase()}`, jobId: result.job.id, leadId: result.job.leadId, attempts: result.job.attempts, error: result.error, timestamp: new Date().toISOString() })}\n`,
    );
  });
}, 1_000);

const shutdown = (signal: string): void => {
  clearInterval(poller);
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "agentfront-worker", event: "worker.stopped", signal, timestamp: new Date().toISOString() })}\n`,
  );
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

export * from "./queue";
