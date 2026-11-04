import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAgentFrontStore, InMemorySalesRepository, PrismaAgentFrontStore, PrismaSalesRepository } from "@agentfront/database";
import { agentFrontRoot, createRuntime } from "./runtime";

describe("API persistence selection", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses credential-free in-memory persistence when DATABASE_URL is absent", async () => {
    const runtime = createRuntime({ DEMO_MODE: "" });
    expect(runtime.store).toBeInstanceOf(InMemoryAgentFrontStore);
    expect(runtime.salesRepository).toBeInstanceOf(InMemorySalesRepository);
    expect(runtime.orchestrator.options.templateRoot).toBe(resolve(agentFrontRoot, "templates"));
    expect(runtime.orchestrator.options.outputRoot).toBe(resolve(agentFrontRoot, ".agentfront-runtime/generated-sites"));
    expect(runtime.orchestrator.options.outputRoot).not.toBe(resolve(agentFrontRoot, "generated-sites"));
    expect(await runtime.persistence.health()).toMatchObject({
      mode: "IN_MEMORY",
      durable: false,
      status: "DEMO",
    });
    await runtime.close();
  });

  it("allows an operator-owned runtime artifact root without touching the canonical example", async () => {
    const runtime = createRuntime({ DEMO_MODE: "true", AGENTFRONT_OUTPUT_ROOT: "var/agentfront-builds" });
    expect(runtime.orchestrator.options.outputRoot).toBe(resolve(agentFrontRoot, "var/agentfront-builds"));
    await runtime.close();
  });

  it("honors an environment emergency stop even in the credential-free local preview", async () => {
    const runtime = createRuntime({ GLOBAL_EMERGENCY_STOP: "true" });
    expect(runtime.environmentEmergencyStopped).toBe(true);
    expect(await runtime.orchestrator.options.shouldPause?.()).toBe(true);
    await runtime.close();
  });

  it("wires MAX_CALL_ATTEMPTS into the sales orchestrator", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T06:00:00.000Z"));
    const runtime = createRuntime({
      TELEPHONY_PROVIDER: "vobiz",
      MAX_CALL_ATTEMPTS: "1",
    });
    const campaign = await runtime.store.getCampaign("campaign-stage-1-demo");
    if (!campaign) throw new Error("The demo campaign is missing.");
    await runtime.salesOrchestrator.queueLead("business-spiceroute", "max-attempts-queue");

    await expect(runtime.salesOrchestrator.startOutboundCall({
      businessId: "business-spiceroute",
      campaign,
      idempotencyKey: "max-attempts-first",
    })).rejects.toThrow(/unavailable/i);
    await expect(runtime.salesOrchestrator.startOutboundCall({
      businessId: "business-spiceroute",
      campaign,
      idempotencyKey: "max-attempts-second",
    })).rejects.toMatchObject({ code: "MAX_ATTEMPTS_REACHED" });
    await runtime.close();
  });

  it("wires MIN_CALL_INTERVAL_MINUTES into the sales orchestrator", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T06:00:00.000Z"));
    const runtime = createRuntime({
      TELEPHONY_PROVIDER: "vobiz",
      MAX_CALL_ATTEMPTS: "3",
      MIN_CALL_INTERVAL_MINUTES: "60",
    });
    const campaign = await runtime.store.getCampaign("campaign-stage-1-demo");
    if (!campaign) throw new Error("The demo campaign is missing.");
    await runtime.salesOrchestrator.queueLead("business-spiceroute", "minimum-interval-queue");

    await expect(runtime.salesOrchestrator.startOutboundCall({
      businessId: "business-spiceroute",
      campaign,
      idempotencyKey: "minimum-interval-first",
    })).rejects.toThrow(/unavailable/i);
    vi.advanceTimersByTime(30 * 60_000);
    await expect(runtime.salesOrchestrator.startOutboundCall({
      businessId: "business-spiceroute",
      campaign,
      idempotencyKey: "minimum-interval-second",
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await runtime.close();
  });

  it("prevents a direct worker from bypassing the founder-approved discovered phone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T06:00:00.000Z"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createRuntime({
      TELEPHONY_PROVIDER: "sarvam",
      SARVAM_API_KEY: "sarvam-test-key",
      SARVAM_ORG_ID: "org-agentfront",
      SARVAM_WORKSPACE_ID: "workspace-sales",
      SARVAM_SALES_APP_ID: "app-sales",
      SARVAM_SALES_APP_VERSION: "1",
      SARVAM_CONNECTION_ID: "connection-vobiz",
      SARVAM_AGENT_PHONE_NUMBER: "+914400000000",
      SARVAM_OUTBOUND_WEBHOOK_URL: "https://api.agentfront.example/api/webhooks/sarvam/outbound?token=test-token",
      SARVAM_ALLOWED_BUSINESS_ID: "business-spiceroute",
      DEMO_BUSINESS_PHONE: "+919876543210",
      SARVAM_ALLOW_DISCOVERED_DESTINATIONS: "true",
    });
    const campaign = await runtime.store.getCampaign("campaign-stage-1-demo");
    const seed = await runtime.store.getBusiness("business-spiceroute");
    if (!campaign || !seed || !(runtime.salesRepository instanceof InMemorySalesRepository)) {
      throw new Error("The in-memory demo fixtures are missing.");
    }
    const selectedPhone = "+91 98400 12999";
    runtime.salesRepository.registerBusiness({
      ...seed,
      id: "google-place-worker-target",
      externalPlaceId: "google-place-worker-target",
      name: "Reviewed Google Business",
      phone: selectedPhone,
      source: "GOOGLE_PLACES",
    });
    await runtime.salesOrchestrator.queueLead("google-place-worker-target", "worker-bypass-queue");

    await expect(runtime.salesOrchestrator.startOutboundCall({
      businessId: "google-place-worker-target",
      campaign,
      idempotencyKey: "worker-bypass-missing",
    })).rejects.toMatchObject({ code: "FOUNDER_APPROVAL_REQUIRED" });
    await expect(runtime.salesOrchestrator.startOutboundCall({
      businessId: "google-place-worker-target",
      campaign,
      idempotencyKey: "worker-bypass-mismatch",
      founderApproved: true,
      approvedPhone: "+919840012001",
    })).rejects.toMatchObject({ code: "FOUNDER_APPROVAL_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("keeps PostgreSQL durable when provider demo mode is enabled", async () => {
    const databaseUrl = "postgresql://agentfront:agentfront@127.0.0.1:1/agentfront";
    const postgres = createRuntime({ DATABASE_URL: databaseUrl });
    expect(postgres.store).toBeInstanceOf(PrismaAgentFrontStore);
    expect(postgres.salesRepository).toBeInstanceOf(PrismaSalesRepository);
    expect(postgres.persistence).toMatchObject({ mode: "POSTGRESQL", durable: true });
    await postgres.close();

    const demo = createRuntime({ DATABASE_URL: databaseUrl, DEMO_MODE: "true" });
    expect(demo.store).toBeInstanceOf(PrismaAgentFrontStore);
    expect(demo.salesRepository).toBeInstanceOf(PrismaSalesRepository);
    expect(demo.persistence.mode).toBe("POSTGRESQL");
    await demo.close();
  });

  it("reports a configured but unreachable database as degraded without failing health", async () => {
    const runtime = createRuntime({
      DATABASE_URL: "postgresql://agentfront:agentfront@127.0.0.1:1/agentfront",
    });
    expect(await runtime.persistence.health()).toMatchObject({
      mode: "POSTGRESQL",
      durable: true,
      status: "DEGRADED",
    });
    await runtime.close();
  });
});
