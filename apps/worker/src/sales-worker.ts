import { randomUUID } from "node:crypto";
import { isWithinCallingWindow, SalesPolicyViolationError, type SalesOrchestrator, type SalesRepository } from "@agentfront/orchestration";
import type {
  Campaign, CRMOutboxItem, CRMProvider, FollowUp, LeadAggregate, SalesBusinessDetail, SalesEvent, SalesJob,
} from "@agentfront/types";

export interface DeveloperExecutionLimits {
  maxBuildRetries: number;
  maxClaudeCallsPerBuild: number;
}

const boundedEnvironmentInteger = (
  value: string | undefined,
  label: string,
  fallback: number,
  maximum: number,
): number => {
  const source = value?.trim();
  if (!source) return fallback;
  if (!/^\d+$/.test(source)) throw new TypeError(`${label} must be a non-negative integer.`);
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new TypeError(`${label} must be an integer between 0 and ${maximum}.`);
  }
  return parsed;
};

/** Read fail-closed developer budgets once when the worker starts. */
export function developerExecutionLimitsFromEnvironment(
  environment: Record<string, string | undefined>,
): DeveloperExecutionLimits {
  return {
    maxBuildRetries: boundedEnvironmentInteger(environment.MAX_BUILD_RETRIES, "MAX_BUILD_RETRIES", 2, 20),
    maxClaudeCallsPerBuild: boundedEnvironmentInteger(
      environment.MAX_OPENAI_CALLS_PER_BUILD ?? environment.MAX_CLAUDE_CALLS_PER_BUILD,
      "MAX_OPENAI_CALLS_PER_BUILD",
      1,
      20,
    ),
  };
}

/** A safety-budget failure must be dead-lettered, never retried automatically. */
export class PermanentSalesWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PermanentSalesWorkerError";
  }
}

/**
 * Enforce provider budgets from durable build-start events. The event is saved
 * before the provider call, so an interrupted/ambiguous request still consumes
 * budget and cannot be repeated indefinitely.
 */
export function assertDeveloperExecutionWithinLimits(
  aggregate: Pick<LeadAggregate, "lead" | "events">,
  limits: DeveloperExecutionLimits,
  usesExternalModel: boolean,
): void {
  if (!["SPEC_GENERATED", "BUILD_QUEUED", "BUILD_FAILED"].includes(aggregate.lead.status)) return;
  const buildAttempts = aggregate.events.filter((event) => event.eventType === "build.started").length;
  const maximumBuildAttempts = limits.maxBuildRetries + 1;
  if (buildAttempts >= maximumBuildAttempts) {
    throw new PermanentSalesWorkerError(
      "MAX_BUILD_RETRIES_REACHED",
      `Developer build retry limit reached (${limits.maxBuildRetries} retries after ${buildAttempts} build attempts).`,
    );
  }
  if (usesExternalModel && buildAttempts >= limits.maxClaudeCallsPerBuild) {
    throw new PermanentSalesWorkerError(
      "MAX_CLAUDE_CALLS_REACHED",
      `Developer model call limit reached (${limits.maxClaudeCallsPerBuild} calls for this build).`,
    );
  }
}

export interface SalesWorkerDependencies {
  repository: SalesRepository;
  orchestrator: SalesOrchestrator;
  crm: CRMProvider;
  getCampaign: (campaignId: string) => Promise<Campaign | null>;
  handoffDeveloper?: (detail: SalesBusinessDetail, attempt: number) => Promise<void>;
  campaignId: string;
  workerId: string;
  clock?: () => Date;
  batchSize?: number;
  leaseMs?: number;
  log?: (event: Record<string, unknown>) => void;
  isEmergencyStopped?: () => Promise<boolean>;
}

export interface SalesWorkerTickResult {
  followUps: number;
  jobs: number;
  outbox: number;
  failures: number;
  skippedOverlap: boolean;
}

class WorkerActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent = false,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "WorkerActionError";
  }
}

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkerActionError("INVALID_PAYLOAD", `${label} is missing.`, true);
  }
  return value.trim();
};

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unknown worker failure.";
  return message
    .replace(/\b(Bearer|Token\s+token=)\s*[^\s,"'}]+/gi, "$1 [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;}]+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
};

/** Pure, capped retry timing shared by job and CRM-outbox lanes. */
export function retryAtForAttempt(now: Date, attempts: number, maxAttempts: number): string | null {
  if (attempts >= maxAttempts) return null;
  const delay = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
  return new Date(now.getTime() + delay).toISOString();
}

/** Find the next permissible minute in the campaign's own timezone. */
export function nextCallingWindowAt(now: Date, campaign: Campaign): string {
  const start = Math.ceil((now.getTime() + 1) / 60_000) * 60_000;
  for (let minute = 0; minute < 48 * 60; minute += 1) {
    const candidate = new Date(start + minute * 60_000);
    if (isWithinCallingWindow(candidate, campaign.callingWindow)) return candidate.toISOString();
  }
  throw new WorkerActionError("INVALID_CALLING_WINDOW", "No allowed calling time exists in the next 48 hours.", true);
}

const outboxPriority: Record<CRMOutboxItem["operation"], number> = {
  UPSERT_BUSINESS: 0,
  SYNC_QUALIFICATION: 0,
  UPSERT_CONTACT: 1,
  SYNC_QUOTE: 2,
  SYNC_DEAL_STAGE: 3,
  SYNC_CALL: 4,
  SYNC_FOLLOW_UP: 4,
  SYNC_REQUIREMENTS: 4,
  SYNC_BUILD_STATUS: 5,
  SYNC_DEPLOYMENT: 6,
};

/**
 * PostgreSQL is the durable source of truth. This process owns only a timer;
 * claims, attempts, retries and terminal failures are persisted by the repo.
 */
export class SalesWorker {
  readonly #clock: () => Date;
  readonly #batchSize: number;
  readonly #leaseMs: number;
  readonly #log: (event: Record<string, unknown>) => void;
  #tickInFlight: Promise<SalesWorkerTickResult> | null = null;

  constructor(readonly dependencies: SalesWorkerDependencies) {
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#batchSize = dependencies.batchSize ?? 20;
    this.#leaseMs = dependencies.leaseMs ?? 5 * 60_000;
    this.#log = dependencies.log ?? (() => {});
    if (!dependencies.workerId.trim()) throw new TypeError("workerId is required.");
    if (!Number.isSafeInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 500) {
      throw new TypeError("batchSize must be an integer between 1 and 500.");
    }
    if (!Number.isSafeInteger(this.#leaseMs) || this.#leaseMs < 1_000) {
      throw new TypeError("leaseMs must be at least 1000 milliseconds.");
    }
  }

  async pollOnce(): Promise<SalesWorkerTickResult> {
    if (this.#tickInFlight) {
      return { followUps: 0, jobs: 0, outbox: 0, failures: 0, skippedOverlap: true };
    }
    const operation = this.#pollOnce();
    this.#tickInFlight = operation;
    try {
      return await operation;
    } finally {
      this.#tickInFlight = null;
    }
  }

  async waitForIdle(): Promise<void> {
    await this.#tickInFlight;
  }

  async #pollOnce(): Promise<SalesWorkerTickResult> {
    const result: SalesWorkerTickResult = { followUps: 0, jobs: 0, outbox: 0, failures: 0, skippedOverlap: false };
    if (await this.dependencies.isEmergencyStopped?.()) return result;
    // Each lane is independent. In particular, a Freshworks outage does not
    // stop sales-job claims or reverse any already-committed sales state.
    for (const [lane, process] of [
      ["followups", () => this.#pollFollowUps(result)],
      ["jobs", () => this.#pollJobs(result)],
      ["outbox", () => this.#pollOutbox(result)],
    ] as const) {
      try {
        await process();
      } catch (error) {
        result.failures += 1;
        this.#log({ level: "error", event: `worker.${lane}.claim_failed`, error: safeError(error) });
      }
    }
    return result;
  }

  async #pollFollowUps(result: SalesWorkerTickResult): Promise<void> {
    const now = this.#now();
    // These lanes run handlers sequentially. Never hold a batch of leases for
    // jobs that have not started yet; a slow call/build could expire them all.
    const claimed = await this.dependencies.repository.claimDueFollowUps(now, Math.min(this.#batchSize, 1));
    for (const followUp of claimed) {
      try {
        await this.#handleFollowUp(followUp);
        await this.#finishFollowUp(followUp, "COMPLETED");
        result.followUps += 1;
        this.#log({ level: "info", event: "followup.completed", followUpId: followUp.id, businessId: followUp.businessId });
      } catch (error) {
        result.failures += 1;
        const retryAt = this.#retryAt(error, followUp.attempts, followUp.maxAttempts);
        await this.#finishFollowUp(followUp, retryAt ? "SCHEDULED" : "FAILED", retryAt, safeError(error));
        this.#log({ level: "error", event: "followup.failed", followUpId: followUp.id, businessId: followUp.businessId, error: safeError(error), retryAt });
      }
    }
  }

  async #handleFollowUp(followUp: FollowUp): Promise<void> {
    if (followUp.type !== "OUTBOUND_CALL") {
      throw new WorkerActionError("FOLLOWUP_CHANNEL_UNAVAILABLE", `No automated ${followUp.type} follow-up adapter is installed.`, true);
    }
    await this.#startAutomaticCall(followUp.businessId, followUp.contactId, `follow-up:${followUp.id}`);
  }

  async #finishFollowUp(
    claimed: FollowUp,
    status: "COMPLETED" | "SCHEDULED" | "FAILED",
    retryAt: string | null = null,
    error: string | null = null,
  ): Promise<void> {
    const detail = await this.dependencies.repository.getDetail(claimed.businessId);
    const current = detail?.followUps.find((item) => item.id === claimed.id);
    if (!current || current.status !== "PROCESSING" || current.attempts !== claimed.attempts) return;
    const now = this.#now();
    const updated: FollowUp = {
      ...current, status,
      scheduledAt: retryAt ?? current.scheduledAt,
      completedAt: status === "COMPLETED" ? now : current.completedAt,
      updatedAt: now,
    };
    const eventType: SalesEvent["eventType"] = status === "COMPLETED"
      ? "FOLLOWUP_COMPLETED" : status === "FAILED" ? "JOB_FAILED" : "JOB_RETRY_SCHEDULED";
    await this.dependencies.repository.applyChange({
      businessId: claimed.businessId,
      followUps: [updated],
      events: [{
        id: randomUUID(), businessId: claimed.businessId, eventType,
        metadata: { followUpId: claimed.id, status, ...(error ? { error } : {}), ...(retryAt ? { retryAt } : {}) },
        correlationId: claimed.businessId,
        idempotencyKey: `follow-up:${claimed.id}:${claimed.attempts}:${status}`,
        timestamp: now,
      }],
    });
  }

  async #pollJobs(result: SalesWorkerTickResult): Promise<void> {
    const claimed = await this.dependencies.repository.claimDueJobs(
      this.#now(), this.dependencies.workerId, this.#batchSize, this.#leaseMs,
    );
    for (const job of claimed) {
      // Long template builds can outlast the original lease. Renew it while
      // the handler runs; without renewal another worker could repeat effects.
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        void this.dependencies.repository.renewJobLease(job.id, this.dependencies.workerId, this.#leaseMs)
          .then((renewed) => { if (!renewed) leaseLost = true; })
          .catch((error: unknown) => {
            leaseLost = true;
            this.#log({ level: "error", event: "sales_job.lease_renewal_failed", jobId: job.id, error: safeError(error) });
          });
      }, Math.max(1_000, Math.floor(this.#leaseMs / 3)));
      heartbeat.unref?.();
      try {
        if (await this.dependencies.isEmergencyStopped?.()) throw new WorkerActionError("GLOBAL_EMERGENCY_STOP", "New sales effects are paused.");
        await this.#handleJob(job);
        if (leaseLost) throw new WorkerActionError("JOB_LEASE_LOST", "Job lease could not be renewed; reconcile provider effects before retry.", true);
        await this.dependencies.repository.completeJob(job.id, this.dependencies.workerId);
        result.jobs += 1;
        this.#log({ level: "info", event: "sales_job.completed", jobId: job.id, type: job.type, businessId: job.businessId });
      } catch (error) {
        result.failures += 1;
        const retryAt = this.#retryAt(error, job.attempts, job.maxAttempts);
        try {
          await this.dependencies.repository.retryJob(job.id, this.dependencies.workerId, safeError(error), retryAt);
        } catch (settleError) {
          this.#log({ level: "error", event: "sales_job.settlement_failed", jobId: job.id, error: safeError(settleError) });
        }
        this.#log({ level: "error", event: "sales_job.failed", jobId: job.id, type: job.type, businessId: job.businessId, error: safeError(error), retryAt });
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  async #handleJob(job: SalesJob): Promise<void> {
    switch (job.type) {
      case "PROCESS_LEAD": {
        const businessId = job.businessId ?? nonEmpty(job.payload.businessId, "businessId");
        await this.dependencies.orchestrator.queueLead(businessId, job.dedupeKey);
        return;
      }
      case "START_OUTBOUND_CALL": {
        const businessId = job.businessId ?? nonEmpty(job.payload.businessId, "businessId");
        const contactId = typeof job.payload.contactId === "string" ? job.payload.contactId : null;
        await this.#startAutomaticCall(businessId, contactId, job.dedupeKey);
        return;
      }
      case "PROCESS_FOLLOW_UP": {
        const businessId = job.businessId ?? nonEmpty(job.payload.businessId, "businessId");
        const followUpId = nonEmpty(job.payload.followUpId, "followUpId");
        const detail = await this.#requireDetail(businessId);
        const followUp = detail.followUps.find((item) => item.id === followUpId);
        if (!followUp) throw new WorkerActionError("FOLLOWUP_NOT_FOUND", "The referenced follow-up does not exist.", true);
        if (followUp.status === "COMPLETED" || followUp.status === "CANCELLED") return;
        if (followUp.status === "FAILED") throw new WorkerActionError("FOLLOWUP_FAILED", "The referenced follow-up failed.", true);
        throw new WorkerActionError("FOLLOWUP_PENDING", "The follow-up scheduler has not completed this action.", false,
          followUp.status === "SCHEDULED" && Date.parse(followUp.scheduledAt) > this.#clock().getTime()
            ? followUp.scheduledAt : null);
      }
      case "TRIGGER_DEVELOPER": {
        if (!this.dependencies.handoffDeveloper) {
          throw new WorkerActionError("DEVELOPER_HANDOFF_UNAVAILABLE", "No verified sales-specification-to-developer delivery bridge is installed.", true);
        }
        const businessId = job.businessId ?? nonEmpty(job.payload.businessId, "businessId");
        const detail = await this.#requireDetail(businessId);
        const expectedSpecId = nonEmpty(job.payload.specId, "specId");
        if (detail.projectSpec?.id !== expectedSpecId) {
          throw new WorkerActionError("SPEC_CORRELATION_FAILED", "Developer job is not bound to the current sales specification.", true);
        }
        await this.dependencies.handoffDeveloper(detail, job.attempts);
        return;
      }
      default:
        throw new WorkerActionError("SALES_JOB_UNSUPPORTED", `Sales job ${job.type} has no safe worker handler.`, true);
    }
  }

  async #startAutomaticCall(businessId: string, contactId: string | null, idempotencyKey: string): Promise<void> {
    const detail = await this.#requireDetail(businessId);
    if (detail.business.source === "DEMO") {
      throw new WorkerActionError("DEMO_BUSINESS_AUTODIAL_BLOCKED", "Seeded demo businesses are never auto-dialled by the worker.", true);
    }
    if (detail.business.source === "GOOGLE_PLACES") {
      throw new WorkerActionError("FOUNDER_APPROVAL_REQUIRED", "Google Places businesses can be called only from the authenticated founder action.", true);
    }
    const campaign = await this.dependencies.getCampaign(this.dependencies.campaignId);
    if (!campaign) throw new WorkerActionError("CAMPAIGN_NOT_FOUND", "The configured sales campaign does not exist.");
    if (campaign.status !== "RUNNING" || !campaign.automaticProcessing) {
      throw new WorkerActionError("AUTOMATIC_PROCESSING_DISABLED", "Campaign automatic processing is not enabled.");
    }
    const now = this.#clock();
    if (!isWithinCallingWindow(now, campaign.callingWindow)) {
      throw new WorkerActionError("OUTSIDE_CALLING_WINDOW", "Automatic calls are restricted to the campaign calling window.", false,
        nextCallingWindowAt(now, campaign));
    }
    await this.dependencies.orchestrator.startOutboundCall({
      businessId, contactId, campaign, idempotencyKey, allowDemoOutsideWindow: false,
    });
  }

  async #pollOutbox(result: SalesWorkerTickResult): Promise<void> {
    const claimed = await this.dependencies.repository.claimDueOutbox(
      this.#now(), this.dependencies.workerId, this.#batchSize, this.#leaseMs,
    );
    claimed.sort((a, b) => outboxPriority[a.operation] - outboxPriority[b.operation] || a.createdAt.localeCompare(b.createdAt));
    for (const item of claimed) {
      try {
        await this.#syncOutbox(item);
        await this.dependencies.repository.completeOutbox(item.id, this.dependencies.workerId);
        result.outbox += 1;
        this.#log({ level: "info", event: "crm_outbox.synced", itemId: item.id, operation: item.operation, businessId: item.businessId });
      } catch (error) {
        result.failures += 1;
        const retryAt = this.#retryAt(error, item.attempts, item.maxAttempts);
        await this.dependencies.repository.retryOutbox(item.id, this.dependencies.workerId, safeError(error), retryAt);
        this.#log({ level: "error", event: "crm_outbox.failed", itemId: item.id, operation: item.operation, businessId: item.businessId, error: safeError(error), retryAt });
      }
    }
  }

  async #syncOutbox(item: CRMOutboxItem): Promise<void> {
    const { crm, repository } = this.dependencies;
    if (crm.mode !== "REAL") {
      throw new WorkerActionError("CRM_DEMO_MODE", "Freshworks is not in REAL mode; CRM outbox remains unsynced.");
    }
    const detail = await this.#requireDetail(item.businessId);
    const accountId = detail.business.freshworksAccountId;
    const dealId = detail.business.freshworksDealId;
    switch (item.operation) {
      case "UPSERT_BUSINESS":
      case "SYNC_QUALIFICATION": {
        if (accountId) return;
        const record = await crm.createAccount({ projectId: item.businessId, business: detail.business }, item.idempotencyKey);
        await repository.setFreshworksAccountId(item.businessId, record.id);
        return;
      }
      case "UPSERT_CONTACT": {
        const contactId = nonEmpty(item.payload.contactId, "contactId");
        const contact = detail.contacts.find((candidate) => candidate.id === contactId);
        if (!contact) throw new WorkerActionError("CONTACT_NOT_FOUND", "CRM contact does not belong to this business.", true);
        if (!accountId) throw new WorkerActionError("CRM_ACCOUNT_REQUIRED", "Freshworks account must sync before its contacts.");
        if (contact.freshworksContactId) {
          throw new WorkerActionError("CRM_CONTACT_UPDATE_UNSUPPORTED", "Freshworks contact already exists, but the provider has no updateContact method.", true);
        }
        const record = await crm.createContact({
          projectId: item.businessId, accountId, business: detail.business,
          displayName: contact.name || detail.business.name,
          contactPhone: contact.phone,
          contactEmail: detail.projectSpec?.contactId === contact.id
            ? detail.projectSpec.specification.contact.email
            : null,
        }, item.idempotencyKey);
        await repository.setFreshworksContactId(item.businessId, contact.id, record.id);
        return;
      }
      case "SYNC_QUOTE": {
        if (!accountId) throw new WorkerActionError("CRM_ACCOUNT_REQUIRED", "Freshworks account must sync before the deal.");
        const decisionMakerId = detail.projectSpec?.contactId ?? detail.memory?.lastContactId;
        const contact = detail.contacts.find((candidate) => candidate.id === decisionMakerId && candidate.isDecisionMaker && candidate.verified);
        if (!contact?.freshworksContactId) throw new WorkerActionError("CRM_CONTACT_REQUIRED", "Decision-maker contact must sync before the deal.");
        const amount = detail.memory?.quotedPrice ?? item.payload.quotedPrice;
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
          throw new WorkerActionError("QUOTE_REQUIRED", "A positive quoted price is required for Freshworks.", true);
        }
        if (dealId) {
          await crm.updateDealStage(dealId, "Negotiating", amount);
          return;
        }
        const record = await crm.createDeal({
          projectId: item.businessId, accountId, contactId: contact.freshworksContactId,
          title: `${detail.business.name} website`, amount, currency: detail.memory?.currency ?? "INR", stage: "Negotiating",
        }, item.idempotencyKey);
        await repository.setFreshworksDealId(item.businessId, record.id);
        return;
      }
      case "SYNC_DEAL_STAGE": {
        if (!dealId) throw new WorkerActionError("CRM_DEAL_REQUIRED", "Freshworks deal must sync before its stage.");
        const stage = nonEmpty(item.payload.stage, "stage");
        const amount = detail.memory?.agreedPrice ?? detail.memory?.quotedPrice ?? undefined;
        await crm.updateDealStage(dealId, stage === "DEAL_WON" ? "Won" : stage === "DEAL_LOST" ? "Lost" : stage, amount);
        return;
      }
      case "SYNC_CALL":
      case "SYNC_FOLLOW_UP":
      case "SYNC_REQUIREMENTS": {
        if (!dealId) throw new WorkerActionError("CRM_DEAL_REQUIRED", "Freshworks deal must sync before timeline notes.");
        const note = this.#crmNote(item, detail);
        await crm.addNote(dealId, `[AgentFront ${item.idempotencyKey}] ${note}`);
        return;
      }
      case "SYNC_BUILD_STATUS": {
        if (!dealId) throw new WorkerActionError("CRM_DEAL_REQUIRED", "Freshworks deal must sync before delivery status.");
        await crm.addNote(dealId, `[AgentFront ${item.idempotencyKey}] Website build and quality assurance passed.`);
        return;
      }
      case "SYNC_DEPLOYMENT": {
        if (!dealId) throw new WorkerActionError("CRM_DEAL_REQUIRED", "Freshworks deal must sync before deployment status.");
        const url = nonEmpty(item.payload.url, "url");
        const providerMode = item.payload.providerMode;
        if (providerMode !== "REAL" && providerMode !== "DEMO") {
          throw new WorkerActionError("INVALID_PAYLOAD", "Deployment provider mode is missing.", true);
        }
        // Freshsales pipelines are tenant-defined; deployment is recorded as a
        // durable timeline milestone while the accepted deal remains Won/Building.
        // Do not require or fabricate a tenant stage named "Deployed".
        await crm.addNote(dealId, `[AgentFront ${item.idempotencyKey}] ${providerMode === "REAL" ? "Live website" : "Demo preview"}: ${url}`);
        return;
      }
      default:
        throw new WorkerActionError("CRM_OPERATION_UNSUPPORTED", `CRM operation ${item.operation} has no verified Freshworks mapping.`, true);
    }
  }

  #crmNote(item: CRMOutboxItem, detail: SalesBusinessDetail): string {
    if (item.operation === "SYNC_CALL") {
      const callId = nonEmpty(item.payload.callId, "callId");
      const call = detail.calls.find((candidate) => candidate.id === callId);
      if (!call) throw new WorkerActionError("CALL_NOT_FOUND", "CRM call does not belong to this business.", true);
      return `Call ${call.direction.toLowerCase()} — ${call.outcome ?? call.status}. ${call.summary ?? "No summary recorded."}`;
    }
    if (item.operation === "SYNC_FOLLOW_UP") {
      const followUpId = nonEmpty(item.payload.followUpId, "followUpId");
      const followUp = detail.followUps.find((candidate) => candidate.id === followUpId);
      if (!followUp) throw new WorkerActionError("FOLLOWUP_NOT_FOUND", "CRM follow-up does not belong to this business.", true);
      return `Follow-up ${followUp.type.toLowerCase()} scheduled for ${followUp.scheduledAt}: ${followUp.reason}`;
    }
    if (item.operation === "SYNC_REQUIREMENTS") {
      const spec = detail.projectSpec;
      if (!spec || spec.id !== item.payload.specId) throw new WorkerActionError("SPEC_NOT_FOUND", "CRM project specification does not belong to this business.", true);
      return `Approved website requirements: ${spec.specification.requirements.pages.join(", ")}.`;
    }
    throw new WorkerActionError("CRM_OPERATION_UNSUPPORTED", "CRM note operation is unsupported.", true);
  }

  async #requireDetail(businessId: string): Promise<SalesBusinessDetail> {
    const detail = await this.dependencies.repository.getDetail(businessId);
    if (!detail) throw new WorkerActionError("BUSINESS_NOT_FOUND", "Sales business does not exist.", true);
    return detail;
  }

  #retryAt(error: unknown, attempts: number, maxAttempts: number): string | null {
    if (error instanceof PermanentSalesWorkerError) return null;
    if (error instanceof WorkerActionError && error.permanent) return null;
    if (error instanceof SalesPolicyViolationError && [
      "DO_NOT_CONTACT", "BLOCKED_NUMBER", "PHONE_REQUIRED", "MAX_ATTEMPTS_REACHED", "STATE_NOT_CALLABLE",
    ].includes(error.code)) return null;
    const now = this.#clock();
    const base = retryAtForAttempt(now, attempts, maxAttempts);
    if (!base) return null;
    if (error instanceof WorkerActionError && error.retryAt && Date.parse(error.retryAt) > Date.parse(base)) {
      return error.retryAt;
    }
    return base;
  }

  #now(): string {
    const at = this.#clock();
    if (!Number.isFinite(at.getTime())) throw new TypeError("Sales worker clock returned an invalid date.");
    return at.toISOString();
  }
}
