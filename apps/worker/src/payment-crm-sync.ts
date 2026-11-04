import type { DodoCrmSyncClaim } from "@agentfront/database";
import type { WorkflowRepository } from "@agentfront/orchestration";
import type { CRMProvider } from "@agentfront/types";

export interface PaymentCrmSyncRepository {
  claimPendingCrmSync(): Promise<DodoCrmSyncClaim | null>;
  markCrmSynced(checkoutId: string, leaseToken: string): Promise<boolean>;
  markCrmSyncFailed(checkoutId: string, leaseToken: string, error: string): Promise<boolean>;
}

export interface PaymentCrmSyncDependencies {
  payments: PaymentCrmSyncRepository;
  workflows: Pick<WorkflowRepository, "findByProjectId">;
  crm: CRMProvider;
  log?: (event: Record<string, unknown>) => void;
}

export interface PaymentCrmSyncTickResult {
  claims: number;
  synced: number;
  failures: number;
  skippedOverlap: boolean;
}

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unknown payment CRM synchronization failure.";
  return message
    .replace(/\b(Bearer|Token\s+token=)\s*[^\s,"'}]+/gi, "$1 [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;}]+/gi, "$1[REDACTED]")
    .slice(0, 500);
};

const normalizedName = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 160);

/** The wording deliberately distinguishes a provider test event from collected/live revenue. */
export function formatDodoTestPaymentNote(claim: DodoCrmSyncClaim, businessName: string): string {
  if (!Number.isSafeInteger(claim.amountMinor) || claim.amountMinor <= 0 || claim.currency !== "INR") {
    throw new TypeError("The claimed Dodo test-payment amount is invalid.");
  }
  const eventTime = new Date(claim.paidAt);
  if (!Number.isFinite(eventTime.getTime())) throw new TypeError("The claimed Dodo test-payment timestamp is invalid.");
  const name = normalizedName(businessName);
  if (!name) throw new TypeError("The payment's business name is missing.");
  return `[AgentFront dodo-test-payment:${claim.paymentId}] Dodo TEST payment webhook verified for ${name} ` +
    `(${claim.projectId}). Sandbox transaction only; not live revenue. Amount: ${claim.currency} ` +
    `${(claim.amountMinor / 100).toFixed(2)}. Provider event time: ${eventTime.toISOString()}.`;
}

/**
 * Claims one verified test payment and mirrors it to Freshworks. The database
 * remains pending unless the real provider accepts the note and the same lease
 * can then be completed.
 */
export class PaymentCrmSyncWorker {
  readonly #log: (event: Record<string, unknown>) => void;
  #tickInFlight: Promise<PaymentCrmSyncTickResult> | null = null;

  constructor(readonly dependencies: PaymentCrmSyncDependencies) {
    this.#log = dependencies.log ?? (() => {});
  }

  async pollOnce(): Promise<PaymentCrmSyncTickResult> {
    if (this.#tickInFlight) {
      return { claims: 0, synced: 0, failures: 0, skippedOverlap: true };
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

  async #pollOnce(): Promise<PaymentCrmSyncTickResult> {
    const claim = await this.dependencies.payments.claimPendingCrmSync();
    if (!claim) return { claims: 0, synced: 0, failures: 0, skippedOverlap: false };
    try {
      const crm = this.dependencies.crm;
      if (crm.mode !== "REAL") {
        throw new Error("Freshworks is not in REAL mode; the test-payment milestone remains pending.");
      }
      const health = await crm.health();
      if (health.mode !== "REAL" || health.status !== "CONNECTED") {
        throw new Error(`Freshworks is not connected (${health.status}); the test-payment milestone remains pending.`);
      }
      const { dealId, businessName } = await this.#resolveCrmContext(claim);
      await crm.addNote(dealId, formatDodoTestPaymentNote(claim, businessName));
      const completed = await this.dependencies.payments.markCrmSynced(claim.checkoutId, claim.leaseToken);
      if (!completed) throw new Error("The payment CRM lease was lost after Freshworks accepted the milestone.");
      this.#log({
        level: "info", event: "dodo_test_payment.crm_synced", checkoutId: claim.checkoutId,
        projectId: claim.projectId, paymentId: claim.paymentId, attempt: claim.attempt,
      });
      return { claims: 1, synced: 1, failures: 0, skippedOverlap: false };
    } catch (error) {
      const message = safeError(error);
      let retryRecorded: boolean;
      try {
        retryRecorded = await this.dependencies.payments.markCrmSyncFailed(
          claim.checkoutId, claim.leaseToken, message,
        );
      } catch (persistenceError) {
        this.#log({
          level: "error", event: "dodo_test_payment.crm_retry_persist_failed",
          checkoutId: claim.checkoutId, projectId: claim.projectId,
          error: safeError(persistenceError), crmError: message,
        });
        throw persistenceError;
      }
      this.#log({
        level: "error", event: "dodo_test_payment.crm_sync_failed", checkoutId: claim.checkoutId,
        projectId: claim.projectId, paymentId: claim.paymentId, attempt: claim.attempt,
        error: message, retryRecorded,
      });
      return { claims: 1, synced: 0, failures: 1, skippedOverlap: false };
    }
  }

  async #resolveCrmContext(claim: DodoCrmSyncClaim): Promise<{ dealId: string; businessName: string }> {
    const aggregate = await this.dependencies.workflows.findByProjectId(claim.projectId);
    if (!aggregate || aggregate.lead.projectId !== claim.projectId) {
      throw new Error("The paid project no longer has a matching workflow record.");
    }
    // Dodo checkout eligibility is joined to this exact workflow lead/deal, so
    // its CRM identity is the only safe target for the payment milestone.
    const dealId = aggregate.lead.freshworksDealId?.trim() || null;
    if (!dealId) throw new Error("The paid project has no persisted Freshworks deal ID.");
    if (!aggregate.deal || aggregate.deal.finalAmount * 100 !== claim.amountMinor) {
      throw new Error("The claimed test payment does not match the persisted accepted amount.");
    }
    if (aggregate.deal.currency !== claim.currency) {
      throw new Error("The claimed test payment does not match the persisted accepted currency.");
    }
    return { dealId, businessName: aggregate.business.name };
  }
}
