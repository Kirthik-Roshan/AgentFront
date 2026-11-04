import { PrismaPg } from "@prisma/adapter-pg";
import { assertSalesTransitionPath } from "@agentfront/orchestration";
import type { SalesChange, SalesListOptions, SalesRepository } from "@agentfront/orchestration";
import type {
  Contact, CRMOutboxItem, FollowUp, SalesBusinessDetail, SalesCall,
  SalesEvent, SalesJob, SalesMemory, SalesProjectSpec, SalesStateTransitionRecord,
} from "@agentfront/types";
import { Prisma, PrismaClient } from "./generated/prisma/client";
import { mapPersistedBusiness } from "./prisma-mappers";

const detailInclude = {
  contacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  calls: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
  salesMemory: true,
  followUps: { orderBy: [{ scheduledAt: "asc" }, { id: "asc" }] },
  salesEvents: { orderBy: [{ timestamp: "desc" }, { id: "desc" }] },
  salesTransitions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  salesProjectSpecs: { orderBy: [{ version: "desc" }, { id: "desc" }], take: 1 },
} as const satisfies Prisma.BusinessInclude;

type DetailRow = Prisma.BusinessGetPayload<{ include: typeof detailInclude }>;
const iso = (value: Date): string => value.toISOString();
const nullableIso = (value: Date | null): string | null => value?.toISOString() ?? null;
const at = (value: string): Date => {
  const result = new Date(value);
  if (Number.isNaN(result.valueOf())) throw new Error(`Invalid ISO date: ${value}`);
  return result;
};
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const bounded = (limit: number): number => Math.max(0, Math.min(500, Math.floor(limit)));

function mapContact(row: DetailRow["contacts"][number]): Contact {
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function mapCall(row: DetailRow["calls"][number]): SalesCall {
  return {
    ...row, startedAt: nullableIso(row.startedAt), endedAt: nullableIso(row.endedAt),
    metadata: row.metadata as Record<string, unknown>, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

function mapMemory(row: NonNullable<DetailRow["salesMemory"]>): SalesMemory {
  return {
    ...row, objections: row.objections as string[], requirements: row.requirements as Record<string, unknown>,
    currency: row.currency as SalesMemory["currency"], nextActionAt: nullableIso(row.nextActionAt),
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

function mapFollowUp(row: DetailRow["followUps"][number]): FollowUp {
  return {
    ...row, scheduledAt: iso(row.scheduledAt), lastAttemptAt: nullableIso(row.lastAttemptAt),
    completedAt: nullableIso(row.completedAt), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

function mapEvent(row: DetailRow["salesEvents"][number]): SalesEvent {
  return { ...row, metadata: row.metadata as Record<string, unknown>, timestamp: iso(row.timestamp) };
}

function mapTransition(row: DetailRow["salesTransitions"][number]): SalesStateTransitionRecord {
  return { ...row, metadata: row.metadata as Record<string, unknown>, createdAt: iso(row.createdAt) };
}

function mapSpec(row: DetailRow["salesProjectSpecs"][number]): SalesProjectSpec {
  return {
    ...row, specification: row.specification as unknown as SalesProjectSpec["specification"],
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

function mapDetail(row: DetailRow): SalesBusinessDetail {
  return {
    business: {
      ...mapPersistedBusiness(row), businessCode: row.businessCode,
      freshworksAccountId: row.freshworksAccountId, freshworksDealId: row.freshworksDealId,
      salesState: row.salesState,
      updatedAt: iso(row.updatedAt),
    },
    contacts: row.contacts.map(mapContact), calls: row.calls.map(mapCall),
    memory: row.salesMemory ? mapMemory(row.salesMemory) : null,
    followUps: row.followUps.map(mapFollowUp), events: row.salesEvents.map(mapEvent),
    transitions: row.salesTransitions.map(mapTransition),
    projectSpec: row.salesProjectSpecs[0] ? mapSpec(row.salesProjectSpecs[0]) : null,
  };
}

function mapJob(row: Awaited<ReturnType<PrismaClient["salesJob"]["findFirst"]>> & {}): SalesJob {
  if (!row) throw new Error("Sales job not found.");
  return {
    ...row, agentType: row.agentType as SalesJob["agentType"], payload: row.payload as Record<string, unknown>, availableAt: iso(row.availableAt),
    lockedAt: nullableIso(row.lockedAt), lockExpiresAt: nullableIso(row.lockExpiresAt),
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

function mapOutbox(row: Awaited<ReturnType<PrismaClient["cRMOutbox"]["findFirst"]>> & {}): CRMOutboxItem {
  if (!row) throw new Error("CRM outbox item not found.");
  return {
    ...row, payload: row.payload as Record<string, unknown>, availableAt: iso(row.availableAt),
    lockedAt: nullableIso(row.lockedAt), lockExpiresAt: nullableIso(row.lockExpiresAt),
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

async function assertContactBelongs(tx: Prisma.TransactionClient, businessId: string, contactId: string | null): Promise<void> {
  if (!contactId) return;
  const contact = await tx.contact.findUnique({ where: { id: contactId }, select: { businessId: true } });
  if (contact?.businessId !== businessId) throw new Error("Cross-business contact reference rejected.");
}

export interface PrismaSalesRepositoryOptions {
  client?: PrismaClient;
  databaseUrl?: string;
}

export class PrismaSalesRepository implements SalesRepository {
  readonly #client: PrismaClient;
  readonly #ownsClient: boolean;

  constructor(options: PrismaSalesRepositoryOptions = {}) {
    const databaseUrl = options.databaseUrl?.trim() || process.env.DATABASE_URL?.trim();
    if (!options.client && !databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL sales persistence.");
    this.#client = options.client ?? new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, connectionTimeoutMillis: 5_000 }),
    });
    this.#ownsClient = !options.client;
  }

  async disconnect(): Promise<void> {
    if (this.#ownsClient) await this.#client.$disconnect();
  }

  async recordWorkerHeartbeat(workerId: string, atTime: string): Promise<void> {
    if (!workerId.trim()) throw new TypeError("Worker ID is required.");
    const lastSeenAt = at(atTime);
    await this.#client.salesWorkerHeartbeat.upsert({
      where: { workerId },
      create: { workerId, lastSeenAt },
      update: { lastSeenAt },
    });
  }

  async getLatestWorkerHeartbeat(): Promise<{ workerId: string; lastSeenAt: string } | null> {
    const row = await this.#client.salesWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } });
    return row ? { workerId: row.workerId, lastSeenAt: row.lastSeenAt.toISOString() } : null;
  }

  async getDetail(businessId: string): Promise<SalesBusinessDetail | null> {
    const row = await this.#client.business.findUnique({ where: { id: businessId }, include: detailInclude });
    return row ? mapDetail(row) : null;
  }

  async list(options: SalesListOptions = {}): Promise<SalesBusinessDetail[]> {
    const rows = await this.#client.business.findMany({
      where: options.salesState ? { salesState: options.salesState } : undefined,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: bounded(options.limit ?? 100), include: detailInclude,
    });
    return rows.map(mapDetail);
  }

  async findContactsByPhone(normalizedPhone: string): Promise<Contact[]> {
    const rows = await this.#client.contact.findMany({ where: { normalizedPhone }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(mapContact);
  }

  async applyChange(change: SalesChange): Promise<SalesBusinessDetail> {
    for (const item of [
      ...(change.contacts ?? []), ...(change.calls ?? []), ...(change.followUps ?? []),
      ...(change.events ?? []), ...(change.transitions ?? []), ...(change.outbox ?? []),
      ...(change.jobs ?? []), ...(change.memory ? [change.memory] : []),
      ...(change.projectSpec ? [change.projectSpec] : []),
    ]) {
      if (item.businessId !== change.businessId) throw new Error("Cross-business sales write rejected.");
    }
    return this.#client.$transaction(async (tx) => {
      // The business row is the aggregate lock. Concurrent state transitions cannot both commit.
      await tx.$queryRaw`SELECT "id" FROM "Business" WHERE "id" = ${change.businessId} FOR UPDATE`;
      const current = await tx.business.findUnique({ where: { id: change.businessId }, select: { salesState: true } });
      if (!current) throw new Error(`Sales business ${change.businessId} not found.`);
      if (change.expectedState && current.salesState !== change.expectedState) {
        throw new Error(`Sales state conflict: expected ${change.expectedState}, found ${current.salesState}.`);
      }
      assertSalesTransitionPath(current.salesState, change.nextState, change.transitions);
      const controlWorkflow = (change.events?.length || change.jobs?.length || change.nextState)
        ? await tx.workflow.upsert({ where: { businessId: change.businessId }, create: {
            id: `workflow-${change.businessId}`, businessId: change.businessId, correlationId: change.businessId,
            currentAgent: "SALES", currentTask: change.nextState ?? "SALES_EVENT",
          }, update: { currentAgent: "SALES", currentTask: change.nextState ?? "SALES_EVENT" } })
        : null;

      for (const item of change.contacts ?? []) {
        const byId = await tx.contact.findUnique({ where: { id: item.id }, select: { businessId: true } });
        if (byId && byId.businessId !== change.businessId) throw new Error("Cross-business contact update rejected.");
        if (item.dedupeKey) {
          const byKey = await tx.contact.findUnique({ where: { dedupeKey: item.dedupeKey }, select: { id: true, businessId: true } });
          if (byKey && (byKey.id !== item.id || byKey.businessId !== change.businessId)) {
            throw new Error("Contact dedupe key collision.");
          }
        }
        const data = {
          businessId: item.businessId, name: item.name, phone: item.phone, normalizedPhone: item.normalizedPhone,
          roles: item.roles, isDecisionMaker: item.isDecisionMaker, preferredLanguage: item.preferredLanguage,
          source: item.source, verified: item.verified, dedupeKey: item.dedupeKey,
        };
        await tx.contact.upsert({
          where: { id: item.id },
          create: { id: item.id, ...data, freshworksContactId: item.freshworksContactId ?? null, createdAt: at(item.createdAt) },
          update: { ...data, ...(item.freshworksContactId !== undefined ? { freshworksContactId: item.freshworksContactId } : {}) },
        });
      }

      for (const item of change.calls ?? []) {
        await assertContactBelongs(tx, change.businessId, item.contactId);
        const byId = await tx.call.findUnique({ where: { id: item.id }, select: { businessId: true } });
        if (byId && byId.businessId !== change.businessId) throw new Error("Cross-business call update rejected.");
        const existing = await tx.call.findUnique({ where: { idempotencyKey: item.idempotencyKey }, select: { id: true, businessId: true } });
        if (existing && (existing.id !== item.id || existing.businessId !== change.businessId)) throw new Error("Call idempotency key collision.");
        const data = {
          businessId: item.businessId, contactId: item.contactId, direction: item.direction,
          provider: item.provider, providerCallId: item.providerCallId, providerMode: item.providerMode,
          status: item.status, startedAt: item.startedAt ? at(item.startedAt) : null,
          endedAt: item.endedAt ? at(item.endedAt) : null, outcome: item.outcome, language: item.language,
          transcript: item.transcript, summary: item.summary, recordingUrl: item.recordingUrl,
          idempotencyKey: item.idempotencyKey, metadata: json(item.metadata),
        };
        await tx.call.upsert({ where: { id: item.id }, create: { id: item.id, ...data, createdAt: at(item.createdAt) }, update: data });
      }

      if (change.memory) {
        const item = change.memory;
        await assertContactBelongs(tx, change.businessId, item.lastContactId);
        const data = {
          summary: item.summary, objections: json(item.objections), requirements: json(item.requirements),
          quotedPrice: item.quotedPrice, agreedPrice: item.agreedPrice, currency: item.currency,
          dealStage: item.dealStage, nextAction: item.nextAction,
          nextActionAt: item.nextActionAt ? at(item.nextActionAt) : null, lastContactId: item.lastContactId,
        };
        await tx.salesMemory.upsert({
          where: { businessId: change.businessId },
          create: { id: item.id, businessId: change.businessId, ...data, createdAt: at(item.createdAt) }, update: data,
        });
      }

      for (const item of change.followUps ?? []) {
        await assertContactBelongs(tx, change.businessId, item.contactId);
        const byId = await tx.followUp.findUnique({ where: { id: item.id }, select: { businessId: true } });
        if (byId && byId.businessId !== change.businessId) throw new Error("Cross-business follow-up update rejected.");
        const existing = await tx.followUp.findUnique({ where: { dedupeKey: item.dedupeKey }, select: { id: true, businessId: true } });
        if (existing && (existing.id !== item.id || existing.businessId !== change.businessId)) throw new Error("Follow-up dedupe key collision.");
        const data = {
          businessId: item.businessId, contactId: item.contactId, type: item.type,
          scheduledAt: at(item.scheduledAt), status: item.status, reason: item.reason,
          attempts: item.attempts, maxAttempts: item.maxAttempts,
          lastAttemptAt: item.lastAttemptAt ? at(item.lastAttemptAt) : null,
          completedAt: item.completedAt ? at(item.completedAt) : null, dedupeKey: item.dedupeKey,
        };
        await tx.followUp.upsert({ where: { id: item.id }, create: { id: item.id, ...data, createdAt: at(item.createdAt) }, update: data });
      }

      for (const item of change.events ?? []) {
        const byId = await tx.salesEvent.findUnique({ where: { id: item.id }, select: { businessId: true } });
        if (byId && byId.businessId !== change.businessId) throw new Error("Cross-business sales event update rejected.");
        const existing = await tx.salesEvent.findUnique({ where: { idempotencyKey: item.idempotencyKey }, select: { id: true, businessId: true } });
        if (existing && (existing.id !== item.id || existing.businessId !== change.businessId)) throw new Error("Sales event idempotency key collision.");
        await tx.salesEvent.upsert({
          where: { id: item.id },
          create: {
            id: item.id, businessId: item.businessId, eventType: item.eventType,
            metadata: json(item.metadata), correlationId: item.correlationId,
            idempotencyKey: item.idempotencyKey, timestamp: at(item.timestamp),
          }, update: {},
        });
        // Project the same committed sales milestone into the existing
        // control-tower ledger; there is no second event source to poll.
        await tx.agentEvent.upsert({ where: { id: `sales-event-${item.id}` }, create: {
          id: `sales-event-${item.id}`, businessId: item.businessId, workflowId: controlWorkflow!.id,
          correlationId: item.correlationId ?? controlWorkflow!.correlationId,
          sourceAgent: "SALES", agentType: "SALES", eventType: `sales.${item.eventType.toLowerCase()}`,
          message: `${item.eventType.replaceAll("_", " ").toLowerCase()}.`, metadata: json(item.metadata),
          payload: json(item.metadata), status: ["CALL_FAILED", "JOB_FAILED"].includes(item.eventType) ? "ERROR" : "INFO",
          retryCount: typeof item.metadata.attempt === "number" && Number.isSafeInteger(item.metadata.attempt)
            ? Math.max(0, item.metadata.attempt - 1) : 0,
          createdAt: at(item.timestamp),
        }, update: {} });
      }

      for (const item of change.transitions ?? []) {
        const byId = await tx.salesStateTransition.findUnique({ where: { id: item.id }, select: { businessId: true } });
        if (byId && byId.businessId !== change.businessId) throw new Error("Cross-business sales transition update rejected.");
        const existing = await tx.salesStateTransition.findUnique({ where: { idempotencyKey: item.idempotencyKey }, select: { id: true, businessId: true } });
        if (existing && (existing.id !== item.id || existing.businessId !== change.businessId)) throw new Error("Sales transition idempotency key collision.");
        await tx.salesStateTransition.upsert({
          where: { id: item.id },
          create: {
            id: item.id, businessId: item.businessId, from: item.from, to: item.to,
            actor: item.actor, reason: item.reason, idempotencyKey: item.idempotencyKey,
            metadata: json(item.metadata), createdAt: at(item.createdAt),
          }, update: {},
        });
      }

      if (change.projectSpec) {
        const item = change.projectSpec;
        await assertContactBelongs(tx, change.businessId, item.contactId);
        const byId = await tx.salesProjectSpec.findUnique({ where: { id: item.id }, select: { businessId: true } });
        if (byId && byId.businessId !== change.businessId) throw new Error("Cross-business project spec update rejected.");
        const existing = await tx.salesProjectSpec.findUnique({ where: { idempotencyKey: item.idempotencyKey }, select: { id: true, businessId: true } });
        if (existing && (existing.id !== item.id || existing.businessId !== change.businessId)) throw new Error("Project spec idempotency key collision.");
        await tx.salesProjectSpec.upsert({
          where: { id: item.id },
          create: {
            id: item.id, businessId: item.businessId, contactId: item.contactId, version: item.version,
            specification: json(item.specification), status: item.status,
            idempotencyKey: item.idempotencyKey, createdAt: at(item.createdAt),
          }, update: { specification: json(item.specification), status: item.status },
        });
      }

      for (const job of change.jobs ?? []) await this.#enqueueJob(tx, job, controlWorkflow?.id);
      for (const item of change.outbox ?? []) await this.#enqueueOutbox(tx, item);
      if (change.nextState) await tx.business.update({ where: { id: change.businessId }, data: { salesState: change.nextState } });
      const row = await tx.business.findUniqueOrThrow({ where: { id: change.businessId }, include: detailInclude });
      return mapDetail(row);
    });
  }

  async listDueFollowUps(now: string, limit: number): Promise<FollowUp[]> {
    const rows = await this.#client.followUp.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: at(now) } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: bounded(limit),
    });
    return rows.map(mapFollowUp);
  }

  async claimDueFollowUps(now: string, limit: number): Promise<FollowUp[]> {
    return this.#client.$transaction(async (tx) => {
      const staleBefore = new Date(at(now).valueOf() - 15 * 60_000);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "FollowUp"
        WHERE "type" = 'OUTBOUND_CALL' AND "attempts" < "maxAttempts" AND (
          ("status" = 'SCHEDULED' AND "scheduledAt" <= ${at(now)}) OR
          ("status" = 'PROCESSING' AND "lastAttemptAt" <= ${staleBefore})
        )
        ORDER BY "scheduledAt", "id"
        LIMIT ${bounded(limit)} FOR UPDATE SKIP LOCKED
      `;
      const claimed: FollowUp[] = [];
      for (const row of rows) {
        const updated = await tx.followUp.update({
          where: { id: row.id },
          data: { status: "PROCESSING", attempts: { increment: 1 }, lastAttemptAt: at(now) },
        });
        claimed.push(mapFollowUp(updated));
      }
      return claimed;
    });
  }

  async enqueueJob(job: SalesJob): Promise<SalesJob> {
    return this.#client.$transaction(async (tx) => {
      const workflow = job.businessId ? await tx.workflow.upsert({ where: { businessId: job.businessId },
        create: { id: `workflow-${job.businessId}`, businessId: job.businessId, correlationId: job.businessId }, update: {} }) : null;
      return mapJob(await this.#enqueueJob(tx, job, workflow?.id));
    });
  }

  async #enqueueJob(tx: Prisma.TransactionClient, job: SalesJob, workflowId?: string) {
    const existing = await tx.salesJob.findUnique({ where: { dedupeKey: job.dedupeKey } });
    if (existing) {
      if (existing.businessId !== job.businessId) throw new Error("Sales job dedupe key collision.");
      return existing;
    }
    return tx.salesJob.create({ data: {
      id: job.id, businessId: job.businessId, type: job.type, payload: json(job.payload),
      workflowId: workflowId ?? job.workflowId ?? null, agentType: job.agentType ?? "SALES",
      status: job.status, availableAt: at(job.availableAt), attempts: job.attempts,
      maxAttempts: job.maxAttempts, lockedAt: job.lockedAt ? at(job.lockedAt) : null,
      lockExpiresAt: job.lockExpiresAt ? at(job.lockExpiresAt) : null, lockedBy: job.lockedBy,
      lastError: job.lastError, dedupeKey: job.dedupeKey, createdAt: at(job.createdAt),
    } });
  }

  async claimDueJobs(now: string, workerId: string, limit: number, leaseMs: number): Promise<SalesJob[]> {
    return this.#client.$transaction(async (tx) => {
      const control = await tx.systemControl.findUnique({ where: { id: "global" } });
      if (control?.emergencyStopped) return [];
      const rows = await tx.salesJob.findMany({
        where: { type: { not: "WORKFLOW_TASK" }, OR: [
          { status: { in: ["QUEUED", "RETRY_SCHEDULED"] }, availableAt: { lte: at(now) } },
          { status: "PROCESSING", lockExpiresAt: { lte: at(now) } },
        ] }, orderBy: [{ availableAt: "asc" }, { id: "asc" }], take: bounded(limit),
      });
      const claimed: SalesJob[] = [];
      for (const row of rows) {
        if (row.attempts >= row.maxAttempts) {
          await tx.salesJob.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
            data: { status: "DEAD_LETTER", lockedAt: null, lockedBy: null, lockExpiresAt: null,
              lastError: "Maximum attempts reached without worker acknowledgement." } });
          continue;
        }
        const updated = await tx.salesJob.updateMany({
          where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
          data: {
            status: "PROCESSING", attempts: { increment: 1 }, lockedAt: at(now),
            lockExpiresAt: new Date(at(now).valueOf() + leaseMs), lockedBy: workerId,
          },
        });
        if (updated.count === 1) claimed.push(mapJob(await tx.salesJob.findUniqueOrThrow({ where: { id: row.id } })));
      }
      return claimed;
    });
  }

  async renewJobLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new TypeError("Invalid lease duration.");
    const now = new Date();
    const result = await this.#client.salesJob.updateMany({ where: {
      id: jobId, lockedBy: workerId, status: "PROCESSING", lockExpiresAt: { gt: now },
    }, data: { lockExpiresAt: new Date(now.getTime() + leaseMs) } });
    return result.count === 1;
  }

  async completeJob(jobId: string, workerId: string): Promise<SalesJob> {
    return this.#client.$transaction(async (tx) => {
      const updated = await tx.salesJob.updateMany({
        where: { id: jobId, lockedBy: workerId, status: "PROCESSING" },
        data: { status: "COMPLETED", lockedAt: null, lockExpiresAt: null, lockedBy: null },
      });
      if (!updated.count) throw new Error("Sales job lease not owned.");
      return mapJob(await tx.salesJob.findUniqueOrThrow({ where: { id: jobId } }));
    });
  }

  async retryJob(jobId: string, workerId: string, error: string, retryAt: string | null): Promise<SalesJob> {
    return this.#client.$transaction(async (tx) => {
      const row = await tx.salesJob.findUnique({ where: { id: jobId } });
      if (!row || row.status !== "PROCESSING" || row.lockedBy !== workerId) throw new Error("Sales job lease not owned.");
      const retry = retryAt !== null && row.attempts < row.maxAttempts;
      const updated = await tx.salesJob.updateMany({
        where: { id: jobId, lockedBy: workerId, status: "PROCESSING", updatedAt: row.updatedAt },
        data: {
          status: retry ? "RETRY_SCHEDULED" : "DEAD_LETTER", availableAt: retry ? at(retryAt!) : row.availableAt,
          lastError: error.slice(0, 2_000), lockedAt: null, lockExpiresAt: null, lockedBy: null,
        },
      });
      if (!updated.count) throw new Error("Sales job lease not owned.");
      return mapJob(await tx.salesJob.findUniqueOrThrow({ where: { id: jobId } }));
    });
  }

  async enqueueOutbox(item: CRMOutboxItem): Promise<CRMOutboxItem> {
    return this.#client.$transaction(async (tx) => mapOutbox(await this.#enqueueOutbox(tx, item)));
  }

  async #enqueueOutbox(tx: Prisma.TransactionClient, item: CRMOutboxItem) {
    const existing = await tx.cRMOutbox.findUnique({ where: { idempotencyKey: item.idempotencyKey } });
    if (existing) {
      if (existing.businessId !== item.businessId) throw new Error("CRM outbox idempotency key collision.");
      return existing;
    }
    return tx.cRMOutbox.create({ data: {
      id: item.id, businessId: item.businessId, operation: item.operation, payload: json(item.payload),
      status: item.status, availableAt: at(item.availableAt), attempts: item.attempts,
      maxAttempts: item.maxAttempts, lockedAt: item.lockedAt ? at(item.lockedAt) : null,
      lockExpiresAt: item.lockExpiresAt ? at(item.lockExpiresAt) : null, lockedBy: item.lockedBy,
      lastError: item.lastError, idempotencyKey: item.idempotencyKey, createdAt: at(item.createdAt),
    } });
  }

  async claimDueOutbox(now: string, workerId: string, limit: number, leaseMs: number): Promise<CRMOutboxItem[]> {
    return this.#client.$transaction(async (tx) => {
      const rows = await tx.cRMOutbox.findMany({
        where: { OR: [
          { status: { in: ["QUEUED", "RETRY_SCHEDULED"] }, availableAt: { lte: at(now) } },
          { status: "PROCESSING", lockExpiresAt: { lte: at(now) } },
        ] }, orderBy: [{ availableAt: "asc" }, { id: "asc" }], take: bounded(limit),
      });
      const claimed: CRMOutboxItem[] = [];
      for (const row of rows) {
        const updated = await tx.cRMOutbox.updateMany({
          where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
          data: {
            status: "PROCESSING", attempts: { increment: 1 }, lockedAt: at(now),
            lockExpiresAt: new Date(at(now).valueOf() + leaseMs), lockedBy: workerId,
          },
        });
        if (updated.count === 1) claimed.push(mapOutbox(await tx.cRMOutbox.findUniqueOrThrow({ where: { id: row.id } })));
      }
      return claimed;
    });
  }

  async completeOutbox(itemId: string, workerId: string): Promise<CRMOutboxItem> {
    return this.#client.$transaction(async (tx) => {
      const updated = await tx.cRMOutbox.updateMany({
        where: { id: itemId, lockedBy: workerId, status: "PROCESSING" },
        data: { status: "SYNCED", lastError: null, lockedAt: null, lockExpiresAt: null, lockedBy: null },
      });
      if (!updated.count) throw new Error("CRM outbox lease not owned.");
      return mapOutbox(await tx.cRMOutbox.findUniqueOrThrow({ where: { id: itemId } }));
    });
  }

  async retryOutbox(itemId: string, workerId: string, error: string, retryAt: string | null): Promise<CRMOutboxItem> {
    return this.#client.$transaction(async (tx) => {
      const row = await tx.cRMOutbox.findUnique({ where: { id: itemId } });
      if (!row || row.status !== "PROCESSING" || row.lockedBy !== workerId) throw new Error("CRM outbox lease not owned.");
      const retry = retryAt !== null && row.attempts < row.maxAttempts;
      const updated = await tx.cRMOutbox.updateMany({
        where: { id: itemId, lockedBy: workerId, status: "PROCESSING", updatedAt: row.updatedAt },
        data: {
          status: retry ? "RETRY_SCHEDULED" : "DEAD_LETTER", availableAt: retry ? at(retryAt!) : row.availableAt,
          lastError: error.slice(0, 2_000), lockedAt: null, lockExpiresAt: null, lockedBy: null,
        },
      });
      if (!updated.count) throw new Error("CRM outbox lease not owned.");
      return mapOutbox(await tx.cRMOutbox.findUniqueOrThrow({ where: { id: itemId } }));
    });
  }

  async setFreshworksAccountId(businessId: string, accountId: string): Promise<SalesBusinessDetail> {
    const id = accountId.trim();
    if (!id) throw new Error("Freshworks account ID is required.");
    const changed = await this.#client.business.updateMany({
      where: { id: businessId, OR: [{ freshworksAccountId: null }, { freshworksAccountId: id }] },
      data: { freshworksAccountId: id },
    });
    if (changed.count !== 1) throw new Error("Freshworks account identity conflict or business not found.");
    const detail = await this.getDetail(businessId);
    if (!detail) throw new Error("Sales business not found after Freshworks account mapping.");
    return detail;
  }

  async setFreshworksDealId(businessId: string, dealId: string): Promise<SalesBusinessDetail> {
    const id = dealId.trim();
    if (!id) throw new Error("Freshworks deal ID is required.");
    const changed = await this.#client.business.updateMany({
      where: { id: businessId, OR: [{ freshworksDealId: null }, { freshworksDealId: id }] },
      data: { freshworksDealId: id },
    });
    if (changed.count !== 1) throw new Error("Freshworks deal identity conflict or business not found.");
    const detail = await this.getDetail(businessId);
    if (!detail) throw new Error("Sales business not found after Freshworks deal mapping.");
    return detail;
  }

  async setFreshworksContactId(businessId: string, contactId: string, freshworksContactId: string): Promise<Contact> {
    const id = freshworksContactId.trim();
    if (!id) throw new Error("Freshworks contact ID is required.");
    const changed = await this.#client.contact.updateMany({
      where: { id: contactId, businessId, OR: [{ freshworksContactId: null }, { freshworksContactId: id }] },
      data: { freshworksContactId: id },
    });
    if (changed.count !== 1) throw new Error("Freshworks contact identity conflict or contact not found for business.");
    const row = await this.#client.contact.findUniqueOrThrow({ where: { id: contactId } });
    return mapContact(row);
  }
}
