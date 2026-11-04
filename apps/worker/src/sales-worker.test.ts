import { describe, expect, it, vi } from "vitest";
import { demoBusinesses, demoCampaign, InMemorySalesRepository } from "@agentfront/database";
import { createProviderSet, createTelephonyProvider } from "@agentfront/integrations";
import { AgentEventBus, SalesOrchestrator } from "@agentfront/orchestration";
import type { CRMOutboxItem, CRMProvider, LeadAggregate, SalesBusinessDetail, SalesJob, SalesProjectSpec } from "@agentfront/types";
import {
  assertDeveloperExecutionWithinLimits,
  developerExecutionLimitsFromEnvironment,
  PermanentSalesWorkerError,
  SalesWorker,
} from "./sales-worker";

const now = "2026-09-19T10:00:00.000Z";

describe("durable sales worker", () => {
  it("parses bounded developer execution limits and rejects unsafe configuration", () => {
    expect(developerExecutionLimitsFromEnvironment({})).toEqual({
      maxBuildRetries: 2,
      maxClaudeCallsPerBuild: 1,
    });
    expect(developerExecutionLimitsFromEnvironment({
      MAX_BUILD_RETRIES: "0",
      MAX_CLAUDE_CALLS_PER_BUILD: "3",
    })).toEqual({ maxBuildRetries: 0, maxClaudeCallsPerBuild: 3 });
    expect(() => developerExecutionLimitsFromEnvironment({ MAX_BUILD_RETRIES: "-1" }))
      .toThrow("MAX_BUILD_RETRIES must be a non-negative integer");
    expect(() => developerExecutionLimitsFromEnvironment({ MAX_CLAUDE_CALLS_PER_BUILD: "21" }))
      .toThrow("MAX_OPENAI_CALLS_PER_BUILD must be an integer between 0 and 20");
  });

  it("enforces persisted build-retry and Claude-call budgets before provider execution", () => {
    const aggregate = (status: LeadAggregate["lead"]["status"], attempts: number) => ({
      lead: { status },
      events: Array.from({ length: attempts }, (_, index) => ({
        eventType: "build.started",
        id: `event-${index}`,
      })),
    }) as Pick<LeadAggregate, "lead" | "events">;
    const limits = { maxBuildRetries: 2, maxClaudeCallsPerBuild: 3 };
    expect(() => assertDeveloperExecutionWithinLimits(aggregate("BUILD_FAILED", 2), limits, true)).not.toThrow();
    expect(() => assertDeveloperExecutionWithinLimits(aggregate("BUILD_FAILED", 3), limits, true))
      .toThrowError(expect.objectContaining({ code: "MAX_BUILD_RETRIES_REACHED" }));
    expect(() => assertDeveloperExecutionWithinLimits(
      aggregate("BUILD_QUEUED", 1), { maxBuildRetries: 5, maxClaudeCallsPerBuild: 1 }, true,
    )).toThrowError(expect.objectContaining({ code: "MAX_CLAUDE_CALLS_REACHED" }));
    expect(() => assertDeveloperExecutionWithinLimits(
      aggregate("DEPLOY_FAILED", 10), { maxBuildRetries: 0, maxClaudeCallsPerBuild: 0 }, true,
    )).not.toThrow();
    expect(() => assertDeveloperExecutionWithinLimits(
      aggregate("BUILD_QUEUED", 1), { maxBuildRetries: 5, maxClaudeCallsPerBuild: 0 }, false,
    )).not.toThrow();
  });

  it("retains local state and retries a failed Freshworks write", async () => {
    const business = demoBusinesses[0]!;
    const repository = new InMemorySalesRepository({ businesses: [business] });
    const outbox: CRMOutboxItem = {
      id: "crm-account-outage", businessId: business.id, operation: "UPSERT_BUSINESS", payload: {},
      status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 3,
      lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
      idempotencyKey: "crm-account-outage", createdAt: now, updatedAt: now,
    };
    await repository.enqueueOutbox(outbox);
    const createAccount = vi.fn(async () => { throw new Error("Freshworks timeout"); });
    const crm = { mode: "REAL", createAccount } as unknown as CRMProvider;
    const orchestrator = new SalesOrchestrator(repository, createTelephonyProvider({ TELEPHONY_PROVIDER: "demo" }), new AgentEventBus());
    const worker = new SalesWorker({ repository, orchestrator, crm,
      getCampaign: async () => demoCampaign, campaignId: demoCampaign.id,
      workerId: "crm-outage-worker", clock: () => new Date(now) });
    const result = await worker.pollOnce();
    expect(result).toMatchObject({ outbox: 0, failures: 1 });
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect((await repository.getDetail(business.id))?.business.freshworksAccountId).toBeNull();
    expect(await repository.claimDueOutbox(now, "other-worker", 10, 60_000)).toEqual([]);
    const retry = await repository.claimDueOutbox("2026-09-19T10:00:31.000Z", "other-worker", 10, 60_000);
    expect(retry).toMatchObject([{ id: outbox.id, attempts: 2 }]);
  });
  it("dispatches only a job correlated to the current sales specification", async () => {
    const business = demoBusinesses[0]!;
    const repository = new InMemorySalesRepository({ businesses: [business] });
    const projectSpec: SalesProjectSpec = {
      id: "spec-worker-1", businessId: business.id, contactId: null,
      version: 1, status: "READY", idempotencyKey: "spec-worker-1",
      specification: {
        schemaVersion: 1, businessId: business.id,
        business: { name: business.name, category: business.category, city: business.city, phone: business.phone ?? "+919840099999" },
        contact: { id: null, name: null, roles: [] },
        requirements: { pages: ["Home"], features: {}, notes: [] }, branding: {},
        commercial: { quotedPrice: 8_000, agreedPrice: 7_500, currency: "INR" },
      },
      createdAt: now, updatedAt: now,
    };
    await repository.applyChange({ businessId: business.id, projectSpec });
    const job = (id: string, specId: string): SalesJob => ({
      id, businessId: business.id, type: "TRIGGER_DEVELOPER", payload: { specId },
      status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 3,
      lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
      dedupeKey: id, createdAt: now, updatedAt: now,
    });
    await repository.enqueueJob(job("job-correct", projectSpec.id));
    await repository.enqueueJob(job("job-forged", "another-spec"));
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const orchestrator = new SalesOrchestrator(repository, createTelephonyProvider({ TELEPHONY_PROVIDER: "demo" }), new AgentEventBus());
    const handoffDeveloper = vi.fn(async (_detail: SalesBusinessDetail) => {});
    const worker = new SalesWorker({ repository, orchestrator, crm: providers.crm,
      getCampaign: async () => demoCampaign, campaignId: demoCampaign.id,
      workerId: "unit-worker", clock: () => new Date(now), handoffDeveloper });
    // Each tick claims one leased job so a slow build cannot let a second
    // unstarted job expire in the worker's own queue.
    const first = await worker.pollOnce();
    const second = await worker.pollOnce();
    expect(first.jobs + second.jobs).toBe(1);
    expect(first.failures + second.failures).toBe(1);
    expect(handoffDeveloper).toHaveBeenCalledTimes(1);
    expect(handoffDeveloper.mock.calls[0]?.[0]).toMatchObject({ projectSpec: { id: projectSpec.id } });
  });

  it("dead-letters an exhausted developer safety budget without automatic retry", async () => {
    const business = demoBusinesses[0]!;
    const repository = new InMemorySalesRepository({ businesses: [business] });
    const projectSpec: SalesProjectSpec = {
      id: "spec-budget", businessId: business.id, contactId: null,
      version: 1, status: "READY", idempotencyKey: "spec-budget",
      specification: {
        schemaVersion: 1, businessId: business.id,
        business: { name: business.name, category: business.category, city: business.city, phone: business.phone ?? "+919840099999" },
        contact: { id: null, name: null, roles: [] },
        requirements: { pages: ["Home"], features: {}, notes: [] }, branding: {},
        commercial: { quotedPrice: 8_000, agreedPrice: 7_500, currency: "INR" },
      },
      createdAt: now, updatedAt: now,
    };
    await repository.applyChange({ businessId: business.id, projectSpec });
    await repository.enqueueJob({
      id: "job-budget", businessId: business.id, type: "TRIGGER_DEVELOPER", payload: { specId: projectSpec.id },
      status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 5,
      lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
      dedupeKey: "job-budget", createdAt: now, updatedAt: now,
    });
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const orchestrator = new SalesOrchestrator(repository, createTelephonyProvider({ TELEPHONY_PROVIDER: "demo" }), new AgentEventBus());
    const handoffDeveloper = vi.fn(async () => {
      throw new PermanentSalesWorkerError("MAX_CLAUDE_CALLS_REACHED", "Claude call limit reached.");
    });
    const worker = new SalesWorker({ repository, orchestrator, crm: providers.crm,
      getCampaign: async () => demoCampaign, campaignId: demoCampaign.id,
      workerId: "budget-worker", clock: () => new Date(now), handoffDeveloper });
    expect(await worker.pollOnce()).toMatchObject({ jobs: 0, failures: 1 });
    expect(await worker.pollOnce()).toMatchObject({ jobs: 0, failures: 0 });
    expect(handoffDeveloper).toHaveBeenCalledTimes(1);
    expect(await repository.claimDueJobs("2026-09-20T10:00:00.000Z", "other-worker", 10, 60_000)).toEqual([]);
  });
});
