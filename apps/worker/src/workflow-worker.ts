import type { ControlTowerRepository } from "@agentfront/orchestration";
import type { CoreAgent, SalesJob } from "@agentfront/types";

export interface WorkflowHandlerContext {
  signal: AbortSignal;
  attempt: number;
  workflowId: string;
  businessId: string;
}

export type WorkflowHandler = (job: SalesJob, context: WorkflowHandlerContext) => Promise<void>;

export interface WorkflowWorkerOptions {
  repository: ControlTowerRepository;
  workerId: string;
  handlers: Partial<Record<CoreAgent, WorkflowHandler>>;
  leaseMs?: number;
  log?: (record: Record<string, unknown>) => void;
}

/** Shared worker mechanics; future provider phases install the five handlers. */
export class WorkflowWorker {
  readonly #leaseMs: number;
  #inFlight: Promise<number> | null = null;

  constructor(readonly options: WorkflowWorkerOptions) {
    if (!options.workerId.trim()) throw new TypeError("A stable worker identity is required.");
    this.#leaseMs = options.leaseMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(this.#leaseMs) || this.#leaseMs < 5_000 || this.#leaseMs > 60 * 60_000) {
      throw new TypeError("Worker lease must be 5 seconds–1 hour.");
    }
  }

  async pollOnce(): Promise<number> {
    if (this.#inFlight) return 0;
    this.#inFlight = this.#poll();
    try { return await this.#inFlight; } finally { this.#inFlight = null; }
  }

  async waitForIdle(): Promise<void> { await this.#inFlight; }

  async #poll(): Promise<number> {
    if (await this.options.repository.emergencyStopped()) return 0;
    // A handler may spend its entire lease running a build. Claim one job at a
    // time so unstarted jobs cannot expire before their renewal timer exists.
    const jobs = await this.options.repository.claim(this.options.workerId, this.#leaseMs, 1);
    let completed = 0;
    for (const job of jobs) {
      const controller = new AbortController();
      let leaseLost = false;
      const renewal = setInterval(() => {
        void this.options.repository.renew(job.id, this.options.workerId, this.#leaseMs)
          .then((owned) => { if (!owned) { leaseLost = true; controller.abort(); } })
          .catch(() => { leaseLost = true; controller.abort(); });
      }, Math.max(1_000, Math.floor(this.#leaseMs / 3)));
      renewal.unref?.();
      try {
        if (await this.options.repository.emergencyStopped()) throw new Error("GLOBAL_EMERGENCY_STOP is active.");
        const agent = job.agentType;
        const handler = agent ? this.options.handlers[agent] : null;
        if (!handler || !job.workflowId || !job.businessId) throw new Error("No installed handler or workflow identity for this job.");
        await handler(job, { signal: controller.signal, attempt: job.attempts,
          workflowId: job.workflowId, businessId: job.businessId });
        if (leaseLost || controller.signal.aborted) throw new Error("Job lease was lost; reconcile external side effects.");
        await this.options.repository.complete(job.id, this.options.workerId);
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown workflow task failure.";
        const retryAt = job.attempts < job.maxAttempts && !leaseLost
          ? new Date(Date.now() + Math.min(30_000 * 2 ** Math.max(0, job.attempts - 1), 30 * 60_000)).toISOString()
          : null;
        try {
          await this.options.repository.fail(job.id, this.options.workerId, message, retryAt);
        } catch (settleError) {
          this.options.log?.({ event: "workflow.lease_lost", jobId: job.id,
            error: settleError instanceof Error ? settleError.message : "Unknown settlement error." });
        }
        this.options.log?.({ event: "workflow.job_failed", jobId: job.id, retryAt });
      } finally {
        clearInterval(renewal);
      }
    }
    return completed;
  }
}
