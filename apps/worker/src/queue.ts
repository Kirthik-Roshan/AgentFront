export interface PipelineJob {
  id: string;
  leadId: string;
  operation: "RUN_PIPELINE" | "RETRY_BUILD" | "RETRY_DEPLOYMENT";
  attempts: number;
  maximumAttempts: number;
  enqueuedAt: string;
}

export interface JobResult {
  job: PipelineJob;
  status: "SUCCEEDED" | "RETRYING" | "FAILED";
  error?: string;
}

export type JobHandler = (job: PipelineJob) => Promise<void>;

export class IdempotentWorkerQueue {
  readonly #pending: PipelineJob[] = [];
  readonly #known = new Set<string>();
  readonly #completed = new Set<string>();
  #running = false;

  constructor(private readonly handler: JobHandler) {}

  enqueue(job: PipelineJob): boolean {
    if (this.#known.has(job.id) || this.#completed.has(job.id)) return false;
    if (!job.id.trim() || !job.leadId.trim()) throw new Error("Worker jobs require stable job and lead IDs.");
    if (!Number.isInteger(job.maximumAttempts) || job.maximumAttempts < 1) {
      throw new Error("maximumAttempts must be a positive integer.");
    }
    this.#known.add(job.id);
    this.#pending.push(structuredClone(job));
    return true;
  }

  async drain(onResult?: (result: JobResult) => void): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#pending.length > 0) {
        const job = this.#pending.shift();
        if (!job) continue;
        job.attempts += 1;
        try {
          await this.handler(structuredClone(job));
          this.#known.delete(job.id);
          this.#completed.add(job.id);
          onResult?.({ job: structuredClone(job), status: "SUCCEEDED" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown worker failure.";
          if (job.attempts < job.maximumAttempts) {
            this.#pending.push(job);
            onResult?.({ job: structuredClone(job), status: "RETRYING", error: message });
          } else {
            this.#known.delete(job.id);
            onResult?.({ job: structuredClone(job), status: "FAILED", error: message });
          }
        }
      }
    } finally {
      this.#running = false;
    }
  }

  get pendingCount(): number {
    return this.#pending.length;
  }
}
