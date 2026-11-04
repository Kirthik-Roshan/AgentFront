import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { DodoCheckoutSession, DodoTestConfig, DodoVerifiedPayment } from "@agentfront/integrations";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const SPICEROUTE_BUSINESS_ID = "business-spiceroute" as const;
const RESERVATION_MS = 30_000;
const CHECKOUT_VALIDITY_MS = 24 * 60 * 60_000;
const CRM_LEASE_MS = 60_000;

export class DodoPersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DodoPersistenceError";
  }
}

const mismatch = (message: string): never => { throw new DodoPersistenceError("PAYMENT_MISMATCH", message); };
const conflict = (message: string): never => { throw new DodoPersistenceError("CHECKOUT_CONFLICT", message); };
const uniqueConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export interface DodoTestRepositoryOptions {
  client?: PrismaClient;
  databaseUrl?: string;
}

export interface DodoCheckoutCustomer { email: string; name?: string }

export type DodoCheckoutReservation =
  | { kind: "reserved"; reservationToken: string }
  | { kind: "in_progress" }
  | { kind: "ready"; session: DodoCheckoutSession };

export interface DodoPaymentStatus {
  projectId: string;
  mode: "TEST";
  status: "NOT_STARTED" | "CHECKOUT_PENDING" | "CHECKOUT_READY" | "TEST_PAID";
  checkoutUrl: string | null;
  checkoutSessionId: string | null;
  paymentId: string | null;
  paidAt: string | null;
  crmSyncedAt: string | null;
  crmLastError: string | null;
}

export interface DodoCrmSyncClaim {
  checkoutId: string;
  leaseToken: string;
  projectId: string;
  paymentId: string;
  amountMinor: number;
  currency: "INR";
  paidAt: string;
  attempt: number;
}

export interface DodoCheckoutEligibility {
  projectStatus: string;
  deploymentStatus: string | null;
  deploymentMode: string | null;
  deploymentUrl: string | null;
  dealStatus: string | null;
  dealAcceptedAt: Date | null;
  dealFinalAmount: number | null;
  dealCurrency: string | null;
}

/** The provider amount is in paise; persisted Deal.finalAmount is in rupees. */
export function assertDodoCheckoutEligibility(eligibility: DodoCheckoutEligibility | null, config: DodoTestConfig): void {
  if (!eligibility || eligibility.projectStatus !== "DEPLOYED" || eligibility.deploymentStatus !== "DEPLOYED" ||
      eligibility.deploymentMode !== "REAL" ||
      !eligibility.deploymentUrl || eligibility.dealStatus !== "WON" || !eligibility.dealAcceptedAt) {
    throw new DodoPersistenceError("DEMO_DEAL_NOT_READY", "SpiceRoute requires a won deal and deployed site before test checkout.");
  }
  if (eligibility.dealCurrency !== "INR" || eligibility.dealFinalAmount === null ||
      eligibility.dealFinalAmount * 100 !== config.expectedAmountMinor) {
    mismatch("The configured test amount does not match the accepted SpiceRoute deal.");
  }
}

function validateConfig(config: DodoTestConfig): void {
  if (!/^AF-\d{4}-\d{6}$/.test(config.projectId) || config.currency !== "INR" ||
      !config.productId || !Number.isSafeInteger(config.expectedAmountMinor) || config.expectedAmountMinor <= 0) {
    throw new DodoPersistenceError("INVALID_CONFIG", "Only a complete SpiceRoute test payment configuration is accepted.");
  }
}

function validatedSession(session: DodoCheckoutSession): DodoCheckoutSession {
  let url: URL;
  try { url = new URL(session.checkoutUrl); } catch { return mismatch("Checkout URL is invalid."); }
  if (!/^AF-\d{4}-\d{6}$/.test(session.projectId) || session.mode !== "TEST" ||
      !/^cks_[A-Za-z0-9_-]{8,128}$/.test(session.sessionId) ||
      url.protocol !== "https:" || url.hostname !== "test.checkout.dodopayments.com") {
    mismatch("Only a verified Dodo test checkout can be stored.");
  }
  return { ...session, checkoutUrl: url.toString() };
}

/** Keep payment milestones in the same control-tower workflow as the lead. */
async function ensurePaymentWorkflow(tx: Prisma.TransactionClient, businessId: string) {
  return tx.workflow.upsert({
    where: { businessId },
    create: { id: `workflow-${businessId}`, businessId, correlationId: businessId },
    update: {},
  });
}

export class PrismaDodoTestRepository {
  readonly #client: PrismaClient;
  readonly #ownsClient: boolean;

  constructor(options: DodoTestRepositoryOptions = {}) {
    const databaseUrl = options.databaseUrl?.trim() || process.env.DATABASE_URL?.trim();
    if (!options.client && !databaseUrl) throw new Error("DATABASE_URL is required for Dodo test persistence.");
    this.#client = options.client ?? new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, connectionTimeoutMillis: 5_000 }),
    });
    this.#ownsClient = !options.client;
  }

  async disconnect(): Promise<void> {
    if (this.#ownsClient) await this.#client.$disconnect();
  }

  /** Reserve before calling Dodo. Only the holder of reservationToken may store the remote session. */
  async reserveCheckoutOnce(
    idempotencyKey: string, customer: DodoCheckoutCustomer, config: DodoTestConfig,
  ): Promise<DodoCheckoutReservation> {
    validateConfig(config);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) conflict("A valid idempotency key is required.");
    const email = customer.email.trim().toLowerCase();
    const name = customer.name?.trim() || null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || (name && name.length > 120)) {
      conflict("Customer details are invalid.");
    }
    const project = await this.#client.project.findUnique({
      where: { projectId: config.projectId },
      include: { deployment: true, lead: { include: { deal: true } } },
    });
    assertDodoCheckoutEligibility(project?.lead.businessId === SPICEROUTE_BUSINESS_ID ? {
      projectStatus: project.status,
      deploymentStatus: project.deployment?.status ?? null,
      deploymentMode: project.deployment?.providerMode ?? null,
      deploymentUrl: project.deployment?.url ?? null,
      dealStatus: project.lead.deal?.status ?? null,
      dealAcceptedAt: project.lead.deal?.acceptedAt ?? null,
      dealFinalAmount: project.lead.deal?.finalAmount ?? null,
      dealCurrency: project.lead.deal?.currency ?? null,
    } : null, config);

    const token = randomUUID();
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + RESERVATION_MS);

    // Dodo checkout URLs are single-use and expire after 24 hours. Preserve the
    // old attempt for webhook audit, but stop it from blocking a fresh attempt.
    await this.#client.dodoTestCheckout.updateMany({
      where: { projectId: config.projectId, status: "READY", checkoutExpiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    await this.#client.dodoTestCheckout.updateMany({
      where: { projectId: config.projectId, status: "RESERVED", reservedUntil: { lte: now } },
      data: { status: "EXPIRED" },
    });


    const existing = await this.#client.dodoTestCheckout.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.projectId !== config.projectId || existing.customerEmail !== email || existing.customerName !== name ||
          existing.productId !== config.productId || existing.amountMinor !== config.expectedAmountMinor || existing.currency !== "INR") {
        conflict("This idempotency key belongs to a different checkout request.");
      }
      if (existing.status === "PAID") conflict("The SpiceRoute test checkout has already been paid.");
      if (existing.status === "EXPIRED") conflict("This checkout attempt expired. Start a new attempt with a new idempotency key.");
      if (existing.status === "READY") {
        if (!existing.checkoutSessionId || !existing.checkoutUrl) return mismatch("A completed checkout has no stored session.");
        return { kind: "ready", session: {
          sessionId: existing.checkoutSessionId, checkoutUrl: existing.checkoutUrl,
          projectId: config.projectId, mode: "TEST",
        } };
      }
      if (existing.reservedUntil > now) return { kind: "in_progress" };
      const changed = await this.#client.dodoTestCheckout.updateMany({
        where: { id: existing.id, status: "RESERVED", reservedUntil: { lte: now } },
        data: { reservationToken: token, reservedUntil },
      });
      return changed.count === 1 ? { kind: "reserved", reservationToken: token } : { kind: "in_progress" };
    }

    const paid = await this.#client.dodoTestCheckout.findFirst({
      where: { projectId: config.projectId, status: "PAID" }, select: { id: true },
    });
    if (paid) conflict("The SpiceRoute test checkout has already been paid.");
    try {
      await this.#client.dodoTestCheckout.create({ data: {
        projectId: config.projectId, idempotencyKey, customerEmail: email, customerName: name,
        productId: config.productId, amountMinor: config.expectedAmountMinor, currency: "INR",
        reservationToken: token, reservedUntil,
      } });
      return { kind: "reserved", reservationToken: token };
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
    }
    const racedKey = await this.#client.dodoTestCheckout.findUnique({ where: { idempotencyKey } });
    if (racedKey) return { kind: "in_progress" };
    const active = await this.#client.dodoTestCheckout.findFirst({
      where: { projectId: config.projectId, status: { in: ["RESERVED", "READY"] } },
      select: { status: true },
    });
    if (active?.status === "READY") conflict("SpiceRoute already has an active test checkout. Use its existing checkout link.");
    throw new DodoPersistenceError("CHECKOUT_IN_PROGRESS", "A concurrent checkout is still being reserved.");
  }

  async finalizeCheckoutReservation(
    idempotencyKey: string, reservationToken: string, proposed: DodoCheckoutSession,
  ): Promise<DodoCheckoutSession> {
    const session = validatedSession(proposed);
    const changed = await this.#client.$transaction(async (tx) => {
      const updated = await tx.dodoTestCheckout.updateMany({
        where: { idempotencyKey, reservationToken, projectId: session.projectId, status: "RESERVED", reservedUntil: { gt: new Date() } },
        data: {
          checkoutSessionId: session.sessionId,
          checkoutUrl: session.checkoutUrl,
          checkoutExpiresAt: new Date(Date.now() + CHECKOUT_VALIDITY_MS),
          status: "READY",
        },
      });
      if (updated.count !== 1) return false;
      const project = await tx.project.findUnique({ where: { projectId: session.projectId },
        select: { leadId: true, lead: { select: { businessId: true } } } });
      const leadId = project?.leadId ?? mismatch("The SpiceRoute project disappeared while storing checkout.");
      const businessId = project?.lead.businessId ?? mismatch("The SpiceRoute business disappeared while storing checkout.");
      const workflow = await ensurePaymentWorkflow(tx, businessId);
      const metadata = { mode: "TEST", checkoutSessionId: session.sessionId };
      await tx.agentEvent.upsert({
        where: { id: `dodo-checkout-${session.sessionId}` },
        create: {
          id: `dodo-checkout-${session.sessionId}`,
          leadId,
          projectId: session.projectId,
          businessId,
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          sourceAgent: "DELIVERY",
          retryCount: 0,
          agentType: "DELIVER",
          eventType: "payment.test.checkout_created",
          message: "Single-use Dodo test checkout created for SpiceRoute Kitchen.",
          metadata,
          payload: metadata,
          status: "INFO",
        },
        update: {},
      });
      return true;
    });
    if (changed) return session;
    const stored = await this.#client.dodoTestCheckout.findUnique({ where: { idempotencyKey } });
    if (stored?.checkoutSessionId === session.sessionId && stored.checkoutUrl === session.checkoutUrl) return session;
    throw new DodoPersistenceError("CHECKOUT_RESERVATION_EXPIRED", "Checkout reservation expired before its session was saved.");
  }

  async releaseCheckoutReservation(idempotencyKey: string, reservationToken: string): Promise<void> {
    await this.#client.dodoTestCheckout.updateMany({
      where: { idempotencyKey, reservationToken, status: "RESERVED" },
      data: { reservedUntil: new Date(0) },
    });
  }

  /** Called only after raw-body signature verification. The DB transaction is the payment authority. */
  async confirmPaymentOnce(payment: DodoVerifiedPayment): Promise<"recorded" | "duplicate"> {
    if (!/^AF-\d{4}-\d{6}$/.test(payment.projectId) || payment.mode !== "TEST" || payment.currency !== "INR" ||
        !payment.productId || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 ||
        !payment.webhookId || !payment.paymentId || !payment.checkoutSessionId) return mismatch("Payment fields are invalid.");
    const occurredAt = new Date(payment.occurredAt);
    if (Number.isNaN(occurredAt.valueOf())) return mismatch("Payment timestamp is invalid.");
    const confirm = async (): Promise<"recorded" | "duplicate"> => this.#client.$transaction(async (tx) => {
      const checkout = await tx.dodoTestCheckout.findUnique({
        where: { checkoutSessionId: payment.checkoutSessionId },
        include: { paymentClaim: true, project: { select: { leadId: true,
          lead: { select: { businessId: true } } } } },
      });
      if (!checkout || checkout.projectId !== payment.projectId || checkout.project.lead.businessId !== SPICEROUTE_BUSINESS_ID ||
          checkout.productId !== payment.productId || checkout.amountMinor !== payment.amountMinor || checkout.currency !== payment.currency ||
          !checkout.checkoutUrl || checkout.status === "RESERVED") return mismatch("Signed payment has no matching stored checkout.");
      const used = await tx.dodoTestPaymentClaim.findFirst({
        where: { OR: [{ webhookId: payment.webhookId }, { paymentId: payment.paymentId }] },
      });
      if (used && (used.checkoutId !== checkout.id || used.paymentId !== payment.paymentId)) {
        mismatch("Webhook ID or payment ID was previously claimed by another payment.");
      }
      if (checkout.status === "PAID") {
        if (checkout.paymentClaim?.paymentId !== payment.paymentId) mismatch("Checkout was paid by another payment.");
        return "duplicate";
      }
      if (used) mismatch("A claimed payment has an unconfirmed checkout.");
      const changed = await tx.dodoTestCheckout.updateMany({
        where: { id: checkout.id, status: "READY" }, data: { status: "PAID", paidAt: occurredAt },
      });
      if (changed.count !== 1) throw new DodoPersistenceError("PAYMENT_RACE", "Payment was concurrently recorded; retry to check its result.");
      await tx.dodoTestPaymentClaim.create({ data: {
        checkoutId: checkout.id, webhookId: payment.webhookId, paymentId: payment.paymentId, occurredAt,
      } });
      const businessId = checkout.project.lead.businessId;
      const workflow = await ensurePaymentWorkflow(tx, businessId);
      const metadata = {
        mode: "TEST",
        paymentId: payment.paymentId,
        checkoutSessionId: payment.checkoutSessionId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      };
      await tx.agentEvent.upsert({
        where: { id: `dodo-test-payment-${payment.paymentId}` },
        create: {
          id: `dodo-test-payment-${payment.paymentId}`,
          leadId: checkout.project.leadId,
          projectId: payment.projectId,
          businessId,
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          sourceAgent: "DELIVERY",
          retryCount: 0,
          agentType: "DELIVER",
          eventType: "payment.test.succeeded",
          message: "Signed Dodo webhook confirmed the SpiceRoute test payment.",
          metadata,
          payload: metadata,
          status: "SUCCESS",
        },
        update: {},
      });
      return "recorded";
    });
    try { return await confirm(); } catch (error) {
      if (!uniqueConflict(error) && !(error instanceof DodoPersistenceError && error.code === "PAYMENT_RACE")) throw error;
      const claim = await this.#client.dodoTestPaymentClaim.findFirst({
        where: { OR: [{ webhookId: payment.webhookId }, { paymentId: payment.paymentId }] },
        include: { checkout: true },
      });
      if (claim?.checkout.checkoutSessionId === payment.checkoutSessionId && claim.paymentId === payment.paymentId &&
          claim.checkout.status === "PAID") return "duplicate";
      return mismatch("Webhook or payment ID conflicts with an existing payment.");
    }
  }

  async getPaymentStatus(projectId: string): Promise<DodoPaymentStatus> {
    if (!/^AF-\d{4}-\d{6}$/.test(projectId)) mismatch("A valid AgentFront project ID is required.");
    const lead = await this.#client.lead.findUnique({
      where: { projectId }, select: { businessId: true },
    });
    if (lead?.businessId !== SPICEROUTE_BUSINESS_ID) mismatch("Only a SpiceRoute project has test checkout enabled.");
    await this.#client.dodoTestCheckout.updateMany({
      where: { projectId, status: "READY", checkoutExpiresAt: { lte: new Date() } },
      data: { status: "EXPIRED" },
    });
    const rows = await this.#client.dodoTestCheckout.findMany({
      where: { projectId, status: { not: "EXPIRED" } }, orderBy: { createdAt: "desc" },
      include: { paymentClaim: true },
    });
    const row = rows.find((item) => item.status === "PAID") ??
      rows.find((item) => item.status === "READY") ?? rows[0];
    return {
      projectId, mode: "TEST",
      status: !row ? "NOT_STARTED" : row.status === "PAID" ? "TEST_PAID" : row.status === "READY" ? "CHECKOUT_READY" : "CHECKOUT_PENDING",
      checkoutUrl: row?.checkoutUrl ?? null, checkoutSessionId: row?.checkoutSessionId ?? null,
      paymentId: row?.paymentClaim?.paymentId ?? null, paidAt: row?.paidAt?.toISOString() ?? null,
      crmSyncedAt: row?.crmSyncedAt?.toISOString() ?? null, crmLastError: row?.crmLastError ?? null,
    };
  }

  /** A leased claim makes Freshworks sync retryable if the worker stops after payment commit. */
  async claimPendingCrmSync(): Promise<DodoCrmSyncClaim | null> {
    const now = new Date();
    const candidates = await this.#client.dodoTestCheckout.findMany({
      where: { project: { lead: { businessId: SPICEROUTE_BUSINESS_ID } }, status: "PAID", crmSyncedAt: null,
        OR: [{ crmLeaseUntil: null }, { crmLeaseUntil: { lte: now } }] },
      orderBy: { paidAt: "asc" }, take: 5, include: { paymentClaim: true },
    });
    for (const row of candidates) {
      if (!row.paymentClaim || !row.paidAt) continue;
      const leaseToken = randomUUID();
      const changed = await this.#client.dodoTestCheckout.updateMany({
        where: { id: row.id, status: "PAID", crmSyncedAt: null,
          OR: [{ crmLeaseUntil: null }, { crmLeaseUntil: { lte: now } }] },
        data: { crmLeaseToken: leaseToken, crmLeaseUntil: new Date(now.getTime() + CRM_LEASE_MS),
          crmAttempts: { increment: 1 } },
      });
      if (changed.count === 1) return {
        checkoutId: row.id, leaseToken, projectId: row.projectId,
        paymentId: row.paymentClaim.paymentId, amountMinor: row.amountMinor, currency: "INR",
        paidAt: row.paidAt.toISOString(), attempt: row.crmAttempts + 1,
      };
    }
    return null;
  }

  async markCrmSynced(checkoutId: string, leaseToken: string): Promise<boolean> {
    return this.#client.$transaction(async (tx) => {
      const checkout = await tx.dodoTestCheckout.findUnique({
        where: { id: checkoutId },
        include: { paymentClaim: true, project: { select: { leadId: true,
          lead: { select: { businessId: true } } } } },
      });
      if (!checkout?.paymentClaim) return false;
      const changed = await tx.dodoTestCheckout.updateMany({
        where: { id: checkoutId, crmLeaseToken: leaseToken, crmSyncedAt: null, status: "PAID" },
        data: { crmSyncedAt: new Date(), crmLastError: null, crmLeaseToken: null, crmLeaseUntil: null },
      });
      if (changed.count !== 1) return false;
      const businessId = checkout.project.lead.businessId;
      const workflow = await ensurePaymentWorkflow(tx, businessId);
      const metadata = { mode: "TEST", paymentId: checkout.paymentClaim.paymentId };
      await tx.agentEvent.upsert({
        where: { id: `dodo-crm-sync-${checkout.id}` },
        create: {
          id: `dodo-crm-sync-${checkout.id}`,
          leadId: checkout.project.leadId,
          projectId: checkout.projectId,
          businessId,
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          sourceAgent: "DELIVERY",
          retryCount: Math.max(0, checkout.crmAttempts - 1),
          agentType: "DELIVER",
          eventType: "payment.test.crm_synced",
          message: "Freshworks deal note records the verified SpiceRoute test payment.",
          metadata,
          payload: metadata,
          status: "SUCCESS",
        },
        update: {},
      });
      return true;
    });
  }

  async markCrmSyncFailed(checkoutId: string, leaseToken: string, error: string): Promise<boolean> {
    const changed = await this.#client.dodoTestCheckout.updateMany({
      where: { id: checkoutId, crmLeaseToken: leaseToken, crmSyncedAt: null, status: "PAID" },
      data: { crmLastError: error.slice(0, 500), crmLeaseToken: null,
        crmLeaseUntil: new Date(Date.now() + 30_000) },
    });
    return changed.count === 1;
  }
}
