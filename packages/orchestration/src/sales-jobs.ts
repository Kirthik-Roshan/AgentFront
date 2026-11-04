import type {
  IntegrationHealth,
  ProviderMode,
  SalesJob,
  SalesJobType,
} from "@agentfront/types";

export interface EnqueueSalesJobInput {
  businessId: string | null;
  type: SalesJobType;
  payload: Record<string, unknown>;
  dedupeKey: string;
  availableAt?: string;
  maxAttempts?: number;
}

export interface EnqueueSalesJobResult {
  job: SalesJob;
  replayed: boolean;
}

export type SalesJobHandler = (job: SalesJob) => Promise<void>;

export interface SalesJobProcessingResult {
  job: SalesJob;
  outcome: "SUCCEEDED" | "RETRY_SCHEDULED" | "DEAD_LETTER";
  error?: string;
}

export interface JobQueue {
  readonly name: string;
  readonly mode: ProviderMode;
  enqueue(input: EnqueueSalesJobInput): Promise<EnqueueSalesJobResult>;
  processDue(handler: SalesJobHandler, maximumJobs?: number): Promise<SalesJobProcessingResult[]>;
  get(jobId: string): Promise<SalesJob | null>;
  list(): Promise<SalesJob[]>;
  cancel(jobId: string): Promise<SalesJob | null>;
  health(): Promise<IntegrationHealth>;
}

export interface SchedulerTickResult {
  status: "COMPLETED" | "FAILED" | "SKIPPED_OVERLAP";
  processed: number;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface Scheduler {
  readonly name: string;
  readonly mode: ProviderMode;
  readonly running: boolean;
  start(): void;
  stop(): void;
  tick(): Promise<SchedulerTickResult>;
  health(): Promise<IntegrationHealth>;
}

export interface LocalJobQueueOptions {
  clock?: () => Date;
  baseRetryDelayMs?: number;
  maximumRetryDelayMs?: number;
}

const clone = <T>(value: T): T => structuredClone(value);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const fingerprint = (value: unknown): string => JSON.stringify(stableValue(value));

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
};

const timestamp = (value: string, label: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new TypeError(`${label} must be an ISO 8601 timestamp with timezone.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(milliseconds).toISOString();
};

const safeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unknown job handler failure.";
  return message
    .replace(/\b(Bearer|Token\s+token=)\s*[^\s,"'}]+/gi, "$1 [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;}]+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
};

const jobInputSnapshot = (input: EnqueueSalesJobInput): Record<string, unknown> => ({
  businessId: input.businessId,
  type: input.type,
  payload: input.payload,
  dedupeKey: input.dedupeKey.trim(),
  // An omitted schedule means "enqueue now", not a new operation each time
  // the same request is delivered. Keep the request fingerprint time-invariant.
  availableAt: input.availableAt ?? null,
  maxAttempts: input.maxAttempts ?? 3,
});

/**
 * Credential-free local adapter. It deliberately makes no durability or
 * distributed-claim claim: queued jobs disappear when this process exits.
 * PostgreSQL remains the production source for persistent SalesJob records.
 */
export class LocalJobQueue implements JobQueue {
  readonly name = "AgentFront Local Job Queue";
  readonly mode = "DEMO" as const;
  readonly #jobs = new Map<string, SalesJob>();
  readonly #jobIdByDedupeKey = new Map<string, string>();
  readonly #fingerprintByDedupeKey = new Map<string, string>();
  readonly #clock: () => Date;
  readonly #baseRetryDelayMs: number;
  readonly #maximumRetryDelayMs: number;
  #sequence = 0;
  #processing: Promise<SalesJobProcessingResult[]> | null = null;

  constructor(options: LocalJobQueueOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 1_000;
    this.#maximumRetryDelayMs = options.maximumRetryDelayMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(this.#baseRetryDelayMs) || this.#baseRetryDelayMs < 1) {
      throw new TypeError("baseRetryDelayMs must be a positive integer.");
    }
    if (!Number.isSafeInteger(this.#maximumRetryDelayMs) || this.#maximumRetryDelayMs < this.#baseRetryDelayMs) {
      throw new TypeError("maximumRetryDelayMs must be an integer no smaller than baseRetryDelayMs.");
    }
  }

  async enqueue(input: EnqueueSalesJobInput): Promise<EnqueueSalesJobResult> {
    const dedupeKey = required(input.dedupeKey, "dedupeKey");
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new TypeError("maxAttempts must be a positive integer.");
    }
    const businessId = input.businessId === null ? null : required(input.businessId, "businessId");
    const now = this.#now();
    const availableAt = input.availableAt ? timestamp(input.availableAt, "availableAt") : now;
    const normalizedInput = { ...clone(input), businessId, dedupeKey, availableAt, maxAttempts };
    const operationFingerprint = fingerprint(jobInputSnapshot({
      ...normalizedInput,
      availableAt: input.availableAt ? availableAt : undefined,
    }));
    const existingId = this.#jobIdByDedupeKey.get(dedupeKey);
    if (existingId) {
      if (this.#fingerprintByDedupeKey.get(dedupeKey) !== operationFingerprint) {
        throw new Error(`Job dedupe key ${dedupeKey} conflicts with another operation.`);
      }
      const existing = this.#jobs.get(existingId);
      if (!existing) throw new Error(`Local job queue index for ${dedupeKey} is inconsistent.`);
      return { job: clone(existing), replayed: true };
    }

    this.#sequence += 1;
    const job: SalesJob = {
      id: `local-sales-job-${this.#sequence}`,
      businessId: normalizedInput.businessId,
      type: normalizedInput.type,
      payload: clone(normalizedInput.payload),
      status: "QUEUED",
      availableAt,
      attempts: 0,
      maxAttempts,
      // This adapter is single-process and intentionally does not manufacture
      // database lease/claim metadata.
      lockedAt: null,
      lockExpiresAt: null,
      lockedBy: null,
      lastError: null,
      dedupeKey,
      createdAt: now,
      updatedAt: now,
    };
    this.#jobs.set(job.id, job);
    this.#jobIdByDedupeKey.set(dedupeKey, job.id);
    this.#fingerprintByDedupeKey.set(dedupeKey, operationFingerprint);
    return { job: clone(job), replayed: false };
  }

  async processDue(
    handler: SalesJobHandler,
    maximumJobs = Number.MAX_SAFE_INTEGER,
  ): Promise<SalesJobProcessingResult[]> {
    if (!Number.isSafeInteger(maximumJobs) || maximumJobs < 1) {
      throw new TypeError("maximumJobs must be a positive integer.");
    }
    // There is no distributed claim/lease in this demo adapter. A second
    // caller must not observe the first caller's results as its own work.
    if (this.#processing) return [];
    this.#processing = this.#processDue(handler, maximumJobs);
    try {
      return clone(await this.#processing);
    } finally {
      this.#processing = null;
    }
  }

  async get(jobId: string): Promise<SalesJob | null> {
    const job = this.#jobs.get(jobId);
    return job ? clone(job) : null;
  }

  async list(): Promise<SalesJob[]> {
    return [...this.#jobs.values()]
      // Map insertion order remains the tie-breaker when the clock has not moved.
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone);
  }

  async cancel(jobId: string): Promise<SalesJob | null> {
    const job = this.#jobs.get(jobId);
    if (!job) return null;
    // Once a handler has started we cannot undo its external side effects.
    // Do not promise cancellation of in-flight work.
    if (["PROCESSING", "COMPLETED", "DEAD_LETTER", "CANCELLED"].includes(job.status)) return clone(job);
    job.status = "CANCELLED";
    job.updatedAt = this.#now();
    return clone(job);
  }

  async health(): Promise<IntegrationHealth> {
    const jobs = [...this.#jobs.values()];
    const pending = jobs.filter((job) => job.status === "QUEUED" || job.status === "RETRY_SCHEDULED").length;
    const deadLetter = jobs.filter((job) => job.status === "DEAD_LETTER").length;
    return {
      integration: "jobQueue",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: `In-memory demo queue active (${pending} pending, ${deadLetter} dead-letter); jobs are not durable across process restarts.`,
      checkedAt: this.#now(),
    };
  }

  async #processDue(handler: SalesJobHandler, maximumJobs: number): Promise<SalesJobProcessingResult[]> {
    const dueAt = Date.parse(this.#now());
    const due = [...this.#jobs.values()]
      .filter((job) =>
        (job.status === "QUEUED" || job.status === "RETRY_SCHEDULED") &&
        Date.parse(job.availableAt) <= dueAt,
      )
      .sort((left, right) =>
        left.availableAt.localeCompare(right.availableAt) ||
        left.createdAt.localeCompare(right.createdAt),
      )
      .slice(0, maximumJobs);
    const results: SalesJobProcessingResult[] = [];

    for (const job of due) {
      // A previous handler may have cancelled a later job in this snapshot.
      if (job.status !== "QUEUED" && job.status !== "RETRY_SCHEDULED") continue;
      job.status = "PROCESSING";
      job.attempts += 1;
      job.updatedAt = this.#now();
      try {
        await handler(clone(job));
        job.status = "COMPLETED";
        job.lastError = null;
        job.updatedAt = this.#now();
        results.push({ job: clone(job), outcome: "SUCCEEDED" });
      } catch (error) {
        const message = safeErrorMessage(error);
        job.lastError = message;
        job.updatedAt = this.#now();
        if (job.attempts >= job.maxAttempts) {
          job.status = "DEAD_LETTER";
          results.push({ job: clone(job), outcome: "DEAD_LETTER", error: message });
          continue;
        }
        const exponentialDelay = this.#baseRetryDelayMs * (2 ** Math.max(0, job.attempts - 1));
        const delay = Math.min(exponentialDelay, this.#maximumRetryDelayMs);
        job.status = "RETRY_SCHEDULED";
        job.availableAt = new Date(this.#clock().getTime() + delay).toISOString();
        results.push({ job: clone(job), outcome: "RETRY_SCHEDULED", error: message });
      }
    }
    return results;
  }

  #now(): string {
    const now = this.#clock();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Local job queue clock returned an invalid date.");
    return now.toISOString();
  }
}

export interface LocalSchedulerOptions {
  processDue: () => Promise<number | void>;
  intervalMs?: number;
  clock?: () => Date;
}

type UnrefableTimer = ReturnType<typeof setInterval> & { unref?: () => void };

/** A process-local polling adapter for development and credential-free demos. */
export class LocalScheduler implements Scheduler {
  readonly name = "AgentFront Local Scheduler";
  readonly mode = "DEMO" as const;
  readonly #processDue: () => Promise<number | void>;
  readonly #intervalMs: number;
  readonly #clock: () => Date;
  #timer: UnrefableTimer | null = null;
  #tickInFlight: Promise<SchedulerTickResult> | null = null;
  #lastError: string | null = null;

  constructor(options: LocalSchedulerOptions) {
    this.#processDue = options.processDue;
    this.#intervalMs = options.intervalMs ?? 1_000;
    this.#clock = options.clock ?? (() => new Date());
    if (!Number.isSafeInteger(this.#intervalMs) || this.#intervalMs < 1) {
      throw new TypeError("intervalMs must be a positive integer.");
    }
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  start(): void {
    if (this.#timer) return;
    const timer = setInterval(() => {
      void this.tick();
    }, this.#intervalMs) as UnrefableTimer;
    timer.unref?.();
    this.#timer = timer;
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async tick(): Promise<SchedulerTickResult> {
    if (this.#tickInFlight) {
      const now = this.#now();
      return { status: "SKIPPED_OVERLAP", processed: 0, startedAt: now, finishedAt: now };
    }
    const operation = this.#runTick();
    this.#tickInFlight = operation;
    try {
      return await operation;
    } finally {
      this.#tickInFlight = null;
    }
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "scheduler",
      provider: this.name,
      mode: this.mode,
      status: this.#lastError ? "DEGRADED" : "DEMO",
      message: this.#lastError
        ? `Local scheduler's most recent tick failed: ${this.#lastError}`
        : this.running
          ? "Process-local demo scheduler is running; timers are not durable across process restarts."
          : "Process-local demo scheduler is stopped; timers are not durable across process restarts.",
      checkedAt: this.#now(),
    };
  }

  async #runTick(): Promise<SchedulerTickResult> {
    const startedAt = this.#now();
    try {
      const processed = await this.#processDue();
      if (processed !== undefined && (!Number.isSafeInteger(processed) || processed < 0)) {
        throw new TypeError("Local scheduler processDue must return a non-negative integer or void.");
      }
      this.#lastError = null;
      return {
        status: "COMPLETED",
        processed: processed ?? 0,
        startedAt,
        finishedAt: this.#now(),
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      this.#lastError = message;
      return {
        status: "FAILED",
        processed: 0,
        startedAt,
        finishedAt: this.#now(),
        error: message,
      };
    }
  }

  #now(): string {
    const now = this.#clock();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Local scheduler clock returned an invalid date.");
    return now.toISOString();
  }
}
