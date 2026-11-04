import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  demoBusinesses,
  demoCampaign,
  PrismaAgentFrontStore,
  PrismaControlTowerRepository,
  PrismaDodoTestRepository,
  PrismaSalesRepository,
} from "@agentfront/database";
import {
  ClaudeDeveloperProvider,
  OpenAIDeveloperProvider,
  createDodoTestCheckout,
  createNotificationProvider,
  createProviderSet,
  createTelephonyProvider,
  dodoTestConfigFromEnv,
} from "@agentfront/integrations";
import { AgentEventBus, AgentFrontOrchestrator, LocalScheduler, SalesOrchestrator, SalesStateMachine } from "@agentfront/orchestration";
import type { CRMOutboxItem, SalesBusinessDetail, SalesEvent, SalesState, SalesStateTransitionRecord } from "@agentfront/types";
import { PaymentCrmSyncWorker } from "./payment-crm-sync";
import {
  assertDeveloperExecutionWithinLimits,
  developerExecutionLimitsFromEnvironment,
  SalesWorker,
} from "./sales-worker";
import { WorkflowWorker, type WorkflowHandler } from "./workflow-worker";

const log = (entry: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ service: "agentfront-worker", timestamp: new Date().toISOString(), ...entry })}\n`);
};

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the durable sales worker. No in-memory fallback is used.");

const repository = new PrismaSalesRepository({ databaseUrl });
const controlTower = new PrismaControlTowerRepository({ databaseUrl,
  emergencyStop: process.env.GLOBAL_EMERGENCY_STOP?.trim().toLowerCase() === "true" });
const store = new PrismaAgentFrontStore({ databaseUrl });
const payments = new PrismaDodoTestRepository({ databaseUrl });
const notifications = createNotificationProvider(process.env);
const providers = createProviderSet(process.env, demoBusinesses);
const developerExecutionLimits = developerExecutionLimitsFromEnvironment(process.env);
const telephony = createTelephonyProvider(process.env);
const events = new AgentEventBus();
const orchestrator = new SalesOrchestrator(repository, telephony, events);
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const delivery = new AgentFrontOrchestrator(store, providers, events, {
  templateRoot: resolve(workspaceRoot, "templates"),
  outputRoot: resolve(workspaceRoot, process.env.AGENTFRONT_OUTPUT_ROOT?.trim() || ".agentfront-runtime/generated-sites"),
  shouldPause: () => controlTower.emergencyStopped(),
});
const salesStates = new SalesStateMachine();
const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;


async function dispatchSpiceRouteDelivery(detail: SalesBusinessDetail, websiteUrl: string, projectId: string): Promise<void> {
  const specification = detail.projectSpec;
  if (!specification || detail.business.id !== "business-spiceroute") return;
  await controlTower.append({
    businessId: detail.business.id, sourceAgent: "DELIVERY", eventType: "DELIVERY_REQUESTED",
    idempotencyKey: `delivery-requested-${specification.id}`,
    message: "SpiceRoute website delivery and test checkout requested.",
    payload: { projectSpecId: specification.id, projectId, websiteUrl },
  });
  const recipient = specification.specification.contact.email?.trim();
  if (!recipient || !notifications.configured) {
    log({ level: "warn", event: "delivery.pending_configuration", businessId: detail.business.id,
      missing: [!recipient ? "customer_email" : null, !notifications.configured ? "email_provider" : null].filter(Boolean) });
    return;
  }
  let configuration;
  try {
    configuration = dodoTestConfigFromEnv(process.env, projectId);
  } catch (error) {
    log({ level: "warn", event: "delivery.pending_configuration", businessId: detail.business.id,
      missing: "dodo_test_configuration", error: error instanceof Error ? error.message : "Invalid Dodo configuration." });
    return;
  }
  const customer = { email: recipient, ...(specification.specification.contact.name
    ? { name: specification.specification.contact.name } : {}) };
  const checkoutKey = `delivery_${specification.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  const reservation = await payments.reserveCheckoutOnce(checkoutKey, customer, configuration);
  if (reservation.kind === "in_progress") throw new Error("Dodo checkout creation is already in progress.");
  let session;
  if (reservation.kind === "ready") session = reservation.session;
  else {
    try {
      const proposed = await createDodoTestCheckout(configuration, customer);
      session = await payments.finalizeCheckoutReservation(checkoutKey, reservation.reservationToken, proposed);
    } catch (error) {
      await payments.releaseCheckoutReservation(checkoutKey, reservation.reservationToken).catch(() => undefined);
      throw error;
    }
  }
  await controlTower.append({
    businessId: detail.business.id, sourceAgent: "DELIVERY", eventType: "PAYMENT_LINK_CREATED",
    idempotencyKey: `payment-link-${specification.id}`,
    message: "Dodo test checkout created for SpiceRoute Kitchen.",
    payload: { projectSpecId: specification.id, checkoutSessionId: session.sessionId,
      amountMinor: configuration.expectedAmountMinor, currency: configuration.currency, mode: session.mode },
  });
  const receipt = await notifications.sendDelivery({
    recipient, customerName: specification.specification.contact.name,
    businessName: specification.specification.business.name, websiteUrl, checkoutUrl: session.checkoutUrl,
    amountMinor: configuration.expectedAmountMinor, currency: configuration.currency,
    idempotencyKey: `agentfront-delivery-${specification.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128),
  });
  await controlTower.append({
    businessId: detail.business.id, sourceAgent: "DELIVERY", eventType: "CLIENT_DELIVERED",
    idempotencyKey: `client-delivered-${specification.id}`,
    message: "Website and Dodo test checkout were emailed to the client.",
    payload: { projectSpecId: specification.id, notificationProvider: receipt.provider,
      notificationId: receipt.messageId, sentAt: receipt.sentAt },
  });
}

async function handoffDeveloper(detail: SalesBusinessDetail, attempt: number): Promise<void> {
  if (await controlTower.emergencyStopped()) throw new Error("GLOBAL_EMERGENCY_STOP is active.");
  if (!detail.projectSpec) throw new Error("Approved project specification is missing.");
  if (detail.business.salesState === "DEPLOYED") {
    const completed = await store.findByBusinessAndCampaign(detail.business.id, `sales-spec-${detail.projectSpec.id}`);
    if (!completed || completed.lead.status !== "DEPLOYED" || !completed.deployment) {
      throw new Error("Sales state is deployed but the correlated deployment record is unavailable.");
    }
    await dispatchSpiceRouteDelivery(detail, completed.deployment.url, completed.lead.projectId);
    return;
  }
  const campaignId = process.env.SALES_CAMPAIGN_ID?.trim() || demoCampaign.id;
  let source = await delivery.handoffSalesSpecification(detail, campaignId);
  assertDeveloperExecutionWithinLimits(
    source,
    developerExecutionLimits,
    providers.developer instanceof ClaudeDeveloperProvider || providers.developer instanceof OpenAIDeveloperProvider,
  );
  if (source.lead.status === "BUILD_FAILED" || source.lead.status === "DEPLOY_FAILED") {
    source = await delivery.retry(source.lead.id, `sales-spec:${detail.projectSpec.id}:retry:${attempt}`, false, "SYSTEM");
  }
  const completed = await delivery.run(source.lead.id);
  if (completed.lead.status !== "DEPLOYED" || !completed.deployment) {
    throw new Error(`Delivery is not complete (pipeline state ${completed.lead.status}).`);
  }
  const latest = await repository.getDetail(detail.business.id);
  if (!latest) throw new Error("Sales business disappeared during delivery.");
  const salesSpec = latest.projectSpec;
  if (!salesSpec) throw new Error("Sales specification disappeared during delivery.");
  if (latest.business.salesState !== "DEPLOYED" && latest.business.salesState !== "SPEC_GENERATED") {
    throw new Error(`Cannot mirror deployment from sales state ${latest.business.salesState}.`);
  }
  if (latest.business.salesState === "SPEC_GENERATED") {
  const now = new Date().toISOString();
  const path: SalesState[] = ["BUILD_PENDING", "BUILDING", "QA", "DEPLOYING", "DEPLOYED"];
  const transitions: SalesStateTransitionRecord[] = [];
  const salesEvents: SalesEvent[] = [];
  let state: SalesState = latest.business.salesState;
  for (const [index, next] of path.entries()) {
    transitions.push(salesStates.transition({ businessId: latest.business.id, currentState: state, targetState: next,
      actor: "SYSTEM", reason: `Existing developer pipeline reached ${completed.lead.status}.`,
      idempotencyKey: `sales-delivery:${salesSpec.id}:${index}`,
      metadata: { projectId: completed.lead.projectId, deploymentId: completed.deployment.id }, at: now },
    [...latest.transitions, ...transitions]).transition);
    salesEvents.push({ id: randomUUID(), businessId: latest.business.id, eventType: "SALES_STATE_CHANGED",
      metadata: { from: state, to: next, projectId: completed.lead.projectId,
        ...(next === "DEPLOYED" ? { url: completed.deployment.url, providerMode: completed.deployment.providerMode } : {}) },
      correlationId: latest.business.id, idempotencyKey: `sales-delivery:${salesSpec.id}:event:${index}`,
      timestamp: now });
    state = next;
  }
  const crmOperations: CRMOutboxItem[] = ["SYNC_BUILD_STATUS", "SYNC_DEPLOYMENT"].map((operation) => ({
    id: randomUUID(), businessId: latest.business.id, operation: operation as CRMOutboxItem["operation"],
    payload: { projectId: completed.lead.projectId, deploymentId: completed.deployment!.id,
      url: completed.deployment!.url, providerMode: completed.deployment!.providerMode },
    status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 8,
    lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
    idempotencyKey: `sales-delivery:${salesSpec.id}:crm:${operation}`,
    createdAt: now, updatedAt: now,
  }));
  await repository.applyChange({ businessId: latest.business.id,
    expectedState: "SPEC_GENERATED", nextState: "DEPLOYED", transitions,
    events: salesEvents, outbox: crmOperations,
    projectSpec: { ...salesSpec, status: "DISPATCHED", updatedAt: now },
  });
  }
  const deployed = await repository.getDetail(detail.business.id);
  if (!deployed) throw new Error("Sales business disappeared before client delivery.");
  await dispatchSpiceRouteDelivery(deployed, completed.deployment.url, completed.lead.projectId);
}
const worker = new SalesWorker({
  repository,
  orchestrator,
  crm: providers.crm,
  getCampaign: (campaignId) => store.getCampaign(campaignId),
  handoffDeveloper,
  campaignId: process.env.SALES_CAMPAIGN_ID?.trim() || demoCampaign.id,
  workerId,
  log,
  isEmergencyStopped: () => controlTower.emergencyStopped(),
});
const runExistingPipeline: WorkflowHandler = async (job, context) => {
  if (job.payload.task !== "RUN_LEGACY_PIPELINE" || typeof job.payload.leadId !== "string") {
    throw new Error("Only an existing lead-bound pipeline continuation can run in the transitional handler.");
  }
  const aggregate = await store.findByLeadId(job.payload.leadId);
  if (!aggregate || aggregate.business.id !== context.businessId || aggregate.business.id !== job.businessId) {
    throw new Error("Workflow job and existing lead have different business identities.");
  }
  if (context.signal.aborted || await controlTower.emergencyStopped()) throw new Error("Workflow execution is paused.");
  const completed = await delivery.run(aggregate.lead.id);
  const state = completed.lead.status;
  // The legacy runner can return without advancing when a campaign is paused.
  // Acknowledge only real terminal/waiting states; otherwise retain the job
  // as retryable/visible instead of silently losing the continuation.
  if (state === "DEPLOYED" && completed.deployment) return;
  const campaignStatus = await store.getCampaignStatus(completed.lead.campaignId);
  if (campaignStatus !== "RUNNING") throw new Error(`Pipeline paused by campaign ${campaignStatus ?? "missing"} at ${state}.`);
  if (state === "CONVERSATION_ACTIVE" || state === "FOLLOW_UP" || state === "DEAL_LOST" ||
    state === "REJECTED") return;
  throw new Error(`Pipeline stopped at ${state} without a terminal result or external callback.`);
};
const workflowWorker = new WorkflowWorker({ repository: controlTower, workerId,
  handlers: { SALES: runExistingPipeline, DEVELOPER: runExistingPipeline }, log });
const paymentCrmSync = new PaymentCrmSyncWorker({
  payments,
  workflows: store,
  crm: providers.crm,
  log,
});

const scheduler = new LocalScheduler({
  intervalMs: 5_000,
  processDue: async () => {
    await repository.recordWorkerHeartbeat(workerId, new Date().toISOString());
    const result = await worker.pollOnce();
    const workflowJobs = await workflowWorker.pollOnce();
    const paymentResult = await paymentCrmSync.pollOnce();
    const failures = result.failures + paymentResult.failures;
    if (result.followUps || result.jobs || result.outbox || workflowJobs || paymentResult.claims || failures) {
      log({
        level: failures ? "warn" : "info", event: "worker.tick", ...result,
        workflowJobs, paymentClaims: paymentResult.claims, paymentsSynced: paymentResult.synced,
        paymentFailures: paymentResult.failures, failures,
      });
    }
    return result.followUps + result.jobs + result.outbox + workflowJobs + paymentResult.synced;
  },
});

const persistence = await store.health();
if (persistence.status !== "CONNECTED") {
  await Promise.all([repository.disconnect(), store.disconnect(), payments.disconnect()]);
  throw new Error("PostgreSQL is unavailable; durable sales worker was not started.");
}

log({
  level: "info", event: "worker.ready", persistence: "POSTGRESQL",
  scheduler: "PROCESS_LOCAL_DEMO_TIMER", crmMode: providers.crm.mode, telephonyMode: telephony.mode,
});
await scheduler.tick();
scheduler.start();

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  scheduler.stop();
  log({ level: "info", event: "worker.stopping", signal });
  try {
    await Promise.all([worker.waitForIdle(), workflowWorker.waitForIdle(), paymentCrmSync.waitForIdle()]);
    await Promise.all([repository.disconnect(), controlTower.disconnect(), store.disconnect(), payments.disconnect()]);
    log({ level: "info", event: "worker.stopped", signal });
  } catch (error) {
    log({ level: "error", event: "worker.shutdown_failed", error: error instanceof Error ? error.message : "Unknown shutdown error." });
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

export * from "./queue";
export * from "./payment-crm-sync";
export * from "./sales-worker";
