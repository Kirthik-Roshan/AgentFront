import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { AppendWorkflowEvent, ControlTowerRepository } from "@agentfront/orchestration";
import type { AgentRun, BusinessWorkflow, CoreAgent, SalesJob, WorkflowEvent } from "@agentfront/types";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 60 * 60_000;
const ALL_AGENTS = new Set<CoreAgent>(["DISCOVER", "SALES", "DEVELOPER", "ADVERTISEMENT", "DELIVERY"]);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const payload = (value: Record<string, unknown>): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)])) : value;
const samePayload = (left: unknown, right: unknown): boolean => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const required = (value: string, label: string): string => {
  if (!value.trim() || value.length > 200) throw new TypeError(`${label} must contain 1–200 characters.`);
  return value.trim();
};
const limitTo = (value: number): number => Number.isSafeInteger(value) ? Math.max(1, Math.min(500, value)) : 100;
const iso = (date: Date): string => date.toISOString();
const safeError = (error: string): string => error
  .replace(/\b(Bearer|Token\s+token=)\s*[^\s,"'}]+/gi, "$1 [REDACTED]")
  .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;}]+/gi, "$1[REDACTED]")
  .slice(0, 1_000);

function workflow(row: Awaited<ReturnType<PrismaClient["workflow"]["findFirst"]>> & {}): BusinessWorkflow {
  if (!row) throw new Error("Workflow not found.");
  return { id: row.id, businessId: row.businessId, correlationId: row.correlationId,
    status: row.status as BusinessWorkflow["status"], currentAgent: row.currentAgent as CoreAgent | null,
    currentTask: row.currentTask, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    completedAt: row.completedAt ? iso(row.completedAt) : null };
}

function job(row: Awaited<ReturnType<PrismaClient["salesJob"]["findFirst"]>> & {}): SalesJob {
  if (!row) throw new Error("Job not found.");
  return { ...row, payload: row.payload as Record<string, unknown>,
    agentType: row.agentType as CoreAgent, availableAt: iso(row.availableAt),
    lockedAt: row.lockedAt ? iso(row.lockedAt) : null,
    lockExpiresAt: row.lockExpiresAt ? iso(row.lockExpiresAt) : null,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function event(row: Awaited<ReturnType<PrismaClient["agentEvent"]["findFirst"]>> & {}): WorkflowEvent {
  if (!row?.businessId || !row.workflowId || !row.correlationId || !row.sourceAgent) {
    throw new Error("The event is not associated with a workflow.");
  }
  return { id: row.id, businessId: row.businessId, workflowId: row.workflowId,
    correlationId: row.correlationId, sourceAgent: row.sourceAgent as CoreAgent,
    retryCount: row.retryCount, payload: (row.payload ?? row.metadata) as Record<string, unknown>,
    leadId: row.leadId, projectId: row.projectId, campaignId: row.campaignId,
    agentType: row.agentType as WorkflowEvent["agentType"], eventType: row.eventType as WorkflowEvent["eventType"],
    message: row.message, metadata: row.metadata as Record<string, unknown>, status: row.status,
    durationMs: row.durationMs, createdAt: iso(row.createdAt) };
}

export interface PrismaControlTowerOptions {
  client?: PrismaClient;
  databaseUrl?: string;
  emergencyStop?: boolean;
}

/** Additive implementation over AgentEvent + SalesJob: never a second queue or event table. */
export class PrismaControlTowerRepository implements ControlTowerRepository {
  readonly #client: PrismaClient;
  readonly #ownsClient: boolean;
  readonly #environmentStop: boolean;

  constructor(options: PrismaControlTowerOptions = {}) {
    const databaseUrl = options.databaseUrl?.trim() || process.env.DATABASE_URL?.trim();
    if (!options.client && !databaseUrl) throw new Error("DATABASE_URL is required for the cloud control tower.");
    this.#client = options.client ?? new PrismaClient({ adapter: new PrismaPg({
      connectionString: databaseUrl!, connectionTimeoutMillis: 5_000,
    }) });
    this.#ownsClient = !options.client;
    this.#environmentStop = options.emergencyStop ?? false;
  }

  async disconnect(): Promise<void> {
    if (this.#ownsClient) await this.#client.$disconnect();
  }

  async emergencyStopped(): Promise<boolean> {
    if (this.#environmentStop) return true;
    const control = await this.#client.systemControl.findUnique({ where: { id: "global" } });
    return control?.emergencyStopped ?? false;
  }

  async setEmergencyStop(stopped: boolean): Promise<void> {
    await this.#client.systemControl.upsert({ where: { id: "global" },
      create: { id: "global", emergencyStopped: stopped }, update: { emergencyStopped: stopped } });
  }

  async append(input: AppendWorkflowEvent): Promise<{ workflow: BusinessWorkflow; event: WorkflowEvent; job: SalesJob | null }> {
    const businessId = required(input.businessId, "businessId");
    const key = required(input.idempotencyKey, "idempotencyKey");
    if (!ALL_AGENTS.has(input.sourceAgent)) throw new TypeError("Unknown agent role.");
    if (input.retryCount !== undefined && (!Number.isSafeInteger(input.retryCount) || input.retryCount < 0)) {
      throw new TypeError("retryCount must be non-negative.");
    }
    const id = `workflow-event-${hash(`${businessId}:${key}`)}`;
    const next = input.nextJob;
    if (next && (!ALL_AGENTS.has(next.agentType) || !next.type.trim() || !next.dedupeKey.trim() ||
      (next.maxAttempts !== undefined && (!Number.isSafeInteger(next.maxAttempts) || next.maxAttempts < 1)))) {
      throw new TypeError("Invalid downstream workflow job.");
    }
    return this.#client.$transaction(async (tx) => {
      const control = await tx.systemControl.findUnique({ where: { id: "global" } });
      if (this.#environmentStop || control?.emergencyStopped) throw new Error("GLOBAL_EMERGENCY_STOP is active.");
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true } });
      if (!business) throw new Error(`Business ${businessId} does not exist.`);
      let record = await tx.workflow.upsert({ where: { businessId },
        create: { id: `workflow-${businessId}`, businessId, correlationId: input.correlationId ?? businessId,
          currentAgent: input.sourceAgent, currentTask: input.eventType }, update: {} });
      const stored = await tx.agentEvent.findUnique({ where: { id } });
      if (stored) {
        if (stored.businessId !== businessId || stored.workflowId !== record.id ||
          stored.eventType !== input.eventType || stored.sourceAgent !== input.sourceAgent ||
          stored.correlationId !== (input.correlationId ?? record.correlationId) ||
          stored.message !== input.message.trim() || stored.status !== (input.status ?? "INFO") ||
          !samePayload(stored.payload, input.payload ?? {})) {
          throw new Error("Workflow event idempotency key was reused for different data.");
        }
        const oldJob = next ? await tx.salesJob.findUnique({ where: { dedupeKey: next.dedupeKey } }) : null;
        if (next && (!oldJob || oldJob.businessId !== businessId || oldJob.workflowId !== record.id ||
          oldJob.agentType !== next.agentType || oldJob.type !== "WORKFLOW_TASK" ||
          !samePayload(oldJob.payload, { ...next.payload, task: next.type }) ||
          oldJob.maxAttempts !== (next.maxAttempts ?? 5))) {
          throw new Error("Workflow event does not match its committed downstream job.");
        }
        return { workflow: workflow(record), event: event(stored), job: oldJob ? job(oldJob) : null };
      }
      if (record.status === "COMPLETED" || record.status === "PAUSED") {
        throw new Error(`Workflow ${record.id} is ${record.status.toLowerCase()}.`);
      }
      record = await tx.workflow.update({ where: { id: record.id }, data: {
        currentAgent: input.sourceAgent, currentTask: input.eventType,
        ...(input.eventType === "WORKFLOW_COMPLETED" ? { status: "COMPLETED", completedAt: new Date() }
          : next ? { status: "ACTIVE" } : {}),
        ...(input.eventType === "WORKFLOW_COMPLETED" ? { status: "COMPLETED", completedAt: new Date() } : {}),
      } });
      const created = await tx.agentEvent.create({ data: {
        id, businessId, workflowId: record.id, correlationId: input.correlationId ?? record.correlationId,
        sourceAgent: input.sourceAgent, agentType: input.sourceAgent, eventType: input.eventType,
        message: required(input.message, "message"), metadata: payload(input.payload ?? {}),
        payload: payload(input.payload ?? {}), status: input.status ?? "INFO", retryCount: input.retryCount ?? 0,
      } });
      let queued = null;
      if (next) {
        if (record.status === "COMPLETED") throw new Error("A completed workflow cannot enqueue more work.");
        const availableAt = next.availableAt ? new Date(next.availableAt) : new Date();
        if (Number.isNaN(availableAt.valueOf())) throw new TypeError("Invalid job schedule.");
        const nextPayload = { ...next.payload, task: next.type };
        const existing = await tx.salesJob.findUnique({ where: { dedupeKey: next.dedupeKey } });
        if (existing && (existing.businessId !== businessId || existing.workflowId !== record.id ||
          existing.agentType !== next.agentType || existing.type !== "WORKFLOW_TASK" ||
          !samePayload(existing.payload, nextPayload))) {
          throw new Error("Workflow job dedupe key was reused for different work.");
        }
        queued = existing ?? await tx.salesJob.create({ data: {
          id: randomUUID(), businessId, workflowId: record.id, agentType: next.agentType,
          type: "WORKFLOW_TASK", payload: payload(nextPayload), dedupeKey: required(next.dedupeKey, "dedupeKey"),
          availableAt, maxAttempts: next.maxAttempts ?? 5,
        } });
      }
      return { workflow: workflow(record), event: event(created), job: queued ? job(queued) : null };
    });
  }

  async listWorkflows(limit = 100): Promise<BusinessWorkflow[]> {
    return (await this.#client.workflow.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limitTo(limit) })).map(workflow);
  }

  async listAgentRuns(limit = 100): Promise<AgentRun[]> {
    const rows = await this.#client.agentRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: limitTo(limit) });
    return rows.map((row) => ({ ...row, agentType: row.agentType as CoreAgent, status: row.status as AgentRun["status"],
      metadata: row.metadata as Record<string, unknown>, startedAt: iso(row.startedAt),
      completedAt: row.completedAt ? iso(row.completedAt) : null }));
  }

  async recentEvents(limit = 100): Promise<WorkflowEvent[]> {
    const rows = await this.#client.agentEvent.findMany({ where: {
      workflowId: { not: null }, businessId: { not: null }, sourceAgent: { not: null },
    }, orderBy: { sequence: "desc" }, take: limitTo(limit) });
    return rows.reverse().map(event);
  }

  /** The monotonically increasing database sequence avoids same-ms cursor gaps. */
  async eventsAfter(cursor: string | null, limit = 100): Promise<WorkflowEvent[]> {
    const point = cursor ? await this.#client.agentEvent.findUnique({ where: { id: cursor }, select: { sequence: true } }) : null;
    if (cursor && !point) throw new TypeError("Unknown event cursor.");
    const rows = await this.#client.agentEvent.findMany({ where: {
      workflowId: { not: null }, businessId: { not: null }, sourceAgent: { not: null },
      ...(point ? { sequence: { gt: point.sequence } } : {}),
    }, orderBy: { sequence: "asc" }, take: limitTo(limit) });
    return rows.map(event);
  }

  async claim(workerId: string, leaseMs: number, limit = 10): Promise<SalesJob[]> {
    required(workerId, "workerId");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < MIN_LEASE_MS || leaseMs > MAX_LEASE_MS) throw new TypeError("Invalid lease duration.");
    return this.#client.$transaction(async (tx) => {
      const control = await tx.systemControl.findUnique({ where: { id: "global" } });
      if (this.#environmentStop || control?.emergencyStopped) return [];
      const now = new Date();
      const due = await tx.salesJob.findMany({ where: { type: "WORKFLOW_TASK", workflowId: { not: null },
        OR: [{ status: { in: ["QUEUED", "RETRY_SCHEDULED"] }, availableAt: { lte: now } },
          { status: "PROCESSING", lockExpiresAt: { lte: now } }],
        workflow: { status: "ACTIVE" },
      }, orderBy: [{ availableAt: "asc" }, { id: "asc" }], take: limitTo(limit) });
      const claimed: SalesJob[] = [];
      for (const item of due) {
        if (item.attempts >= item.maxAttempts) {
          const failed = await tx.salesJob.updateMany({ where: { id: item.id, status: item.status, updatedAt: item.updatedAt },
            data: { status: "DEAD_LETTER", lockedAt: null, lockedBy: null, lockExpiresAt: null,
              lastError: "Maximum attempts reached without a worker acknowledgement." } });
          if (failed.count && item.workflowId) {
            await tx.agentRun.updateMany({ where: { jobId: item.id, status: "RUNNING" },
              data: { status: "FAILED", errorMessage: "Worker lease expired after maximum attempts.", completedAt: now } });
            await tx.workflow.update({ where: { id: item.workflowId },
              data: { status: "FAILED", currentTask: "Job exhausted its retry limit." } });
          }
          continue;
        }
        const updated = await tx.salesJob.updateMany({ where: { id: item.id, status: item.status, updatedAt: item.updatedAt },
          data: { status: "PROCESSING", attempts: { increment: 1 }, lockedBy: workerId,
            lockedAt: now, lockExpiresAt: new Date(now.getTime() + leaseMs) } });
        if (!updated.count) continue;
        const current = await tx.salesJob.findUniqueOrThrow({ where: { id: item.id } });
        if (item.status === "PROCESSING") await tx.agentRun.updateMany({ where: {
          jobId: item.id, retryCount: current.attempts - 2, status: "RUNNING",
        }, data: { status: "FAILED", errorMessage: "Worker lease expired before acknowledgement.", completedAt: now } });
        await tx.agentRun.create({ data: { id: randomUUID(), workflowId: current.workflowId!, businessId: current.businessId!,
          jobId: current.id, agentType: current.agentType, retryCount: current.attempts - 1,
          status: "RUNNING", startedAt: now } });
        claimed.push(job(current));
      }
      return claimed;
    });
  }

  async renew(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < MIN_LEASE_MS || leaseMs > MAX_LEASE_MS) throw new TypeError("Invalid lease duration.");
    if (await this.emergencyStopped()) return false;
    const now = new Date();
    const result = await this.#client.salesJob.updateMany({ where: { id: jobId, lockedBy: workerId,
      status: "PROCESSING", lockExpiresAt: { gt: now } },
    data: { lockExpiresAt: new Date(now.getTime() + leaseMs) } });
    return result.count === 1;
  }

  async complete(jobId: string, workerId: string): Promise<void> {
    await this.#settle(jobId, workerId, null, null);
  }

  async fail(jobId: string, workerId: string, error: string, retryAt: string | null): Promise<void> {
    await this.#settle(jobId, workerId, safeError(error), retryAt);
  }

  async #settle(jobId: string, workerId: string, error: string | null, retryAt: string | null): Promise<void> {
    await this.#client.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.salesJob.findUnique({ where: { id: jobId } });
      if (!current || current.type !== "WORKFLOW_TASK" || current.status !== "PROCESSING" ||
        current.lockedBy !== workerId || !current.lockExpiresAt || current.lockExpiresAt <= now) {
        throw new Error("Workflow job lease is not owned or has expired.");
      }
      const schedule = retryAt ? new Date(retryAt) : null;
      if (schedule && Number.isNaN(schedule.valueOf())) throw new TypeError("Invalid retry timestamp.");
      const retry = error !== null && schedule !== null && current.attempts < current.maxAttempts;
      const status = error === null ? "COMPLETED" : retry ? "RETRY_SCHEDULED" : "DEAD_LETTER";
      const updated = await tx.salesJob.updateMany({ where: { id: current.id, status: "PROCESSING",
        lockedBy: workerId, lockExpiresAt: { gt: now } }, data: {
        status, lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: error,
        ...(retry && schedule ? { availableAt: schedule } : {}),
      } });
      if (!updated.count) throw new Error("Workflow job lease changed while settling.");
      await tx.agentRun.update({ where: { jobId_retryCount: { jobId, retryCount: current.attempts - 1 } },
        data: { status: error === null ? "SUCCEEDED" : retry ? "RETRY_SCHEDULED" : "FAILED",
          errorMessage: error, completedAt: now } });
      if (error === null && current.workflowId) {
        const remaining = await tx.salesJob.count({ where: { workflowId: current.workflowId,
          status: { in: ["QUEUED", "PROCESSING", "RETRY_SCHEDULED"] } } });
        if (remaining === 0) await tx.workflow.updateMany({ where: { id: current.workflowId, status: "ACTIVE" },
          data: { status: "IDLE", currentAgent: null, currentTask: null } });
      }
      if (!retry && error && current.workflowId) await tx.workflow.update({ where: { id: current.workflowId },
        data: { status: "FAILED", currentTask: `Failed: ${String((current.payload as Record<string, unknown>).task ?? current.type)}` } });
    });
  }
}
