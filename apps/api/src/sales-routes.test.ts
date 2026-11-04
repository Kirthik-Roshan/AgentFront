import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter } from "./router";
import { createRuntime } from "./runtime";

type TestResponse = { status: number; body: { ok?: boolean; data?: unknown; error?: { code: string } } };

async function request(
  router: ReturnType<typeof createRouter>,
  path: string,
  options: { method?: string; body?: unknown; headers?: IncomingHttpHeaders } = {},
): Promise<TestResponse> {
  const incoming = Readable.from(options.body === undefined ? [] : [JSON.stringify(options.body)]) as IncomingMessage;
  Object.assign(incoming, {
    method: options.method ?? "GET", url: path,
    headers: Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
  });
  let status = 0;
  let output = "";
  const outgoing = {
    setHeader() { return this; },
    writeHead(code: number) { status = code; return this; },
    end(chunk?: unknown) { output += String(chunk ?? ""); return this; },
    write(chunk: unknown) { output += String(chunk); return true; },
  } as unknown as ServerResponse;
  await router(incoming, outgoing);
  return { status, body: output ? JSON.parse(output) as TestResponse["body"] : {} };
}

const post = (router: ReturnType<typeof createRouter>, path: string, key: string, body: unknown) =>
  request(router, path, { method: "POST", headers: { "idempotency-key": key }, body });

describe("sales operations API", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("persists a simulated receptionist-to-owner journey and restores inbound context", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "agentfront-sales-handoff-"));
    const environment = { DEMO_MODE: "true", TELEPHONY_PROVIDER: "demo", WEB_ORIGIN: "http://localhost:3000", AGENTFRONT_OUTPUT_ROOT: outputRoot };
    const runtime = createRuntime(environment);
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const businessId = "business-spiceroute";
    const base = `/api/sales/businesses/${businessId}`;

    const queued = await post(router, `${base}/queue`, "journey-queue", {});
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ data: { business: { id: businessId, salesState: "CALL_PENDING" } } });

    const started = await post(router, `${base}/call`, "journey-call", { allowDemoOutsideWindow: true });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ data: { mode: "DEMO", label: "SIMULATED TELEPHONY", call: { status: "RINGING" } } });
    const callId = (started.body.data as { call: { id: string } }).call.id;

    const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
    const handoff = await post(router, `${base}/receptionist-handoff`, "journey-handoff", {
      callId, receptionistName: "Front desk", ownerName: "Raj", ownerPhone: "+91 98400 99999",
      callbackAt, summary: "Receptionist said Raj owns the restaurant and will call tomorrow.",
      preferredLanguage: "TAMIL",
    });
    expect(handoff.status).toBe(200);
    const handoffDetail = (handoff.body.data as { detail: { business: { salesState: string }; contacts: Array<{ id: string; businessId: string; name: string; isDecisionMaker: boolean }>; followUps: unknown[] } }).detail;
    expect(handoffDetail.business.salesState).toBe("FOLLOW_UP_SCHEDULED");
    const owner = handoffDetail.contacts.find((contact) => contact.name === "Raj");
    expect(owner).toMatchObject({ businessId, isDecisionMaker: true });
    expect(handoffDetail.followUps).toHaveLength(1);

    const unknown = await post(router, "/api/sales/inbound", "unknown-inbound", {
      callerPhone: "+919888877777", providerCallId: "demo-unknown-1",
    });
    expect(unknown.body).toMatchObject({ data: { resolution: { status: "UNKNOWN_CALLER", disclosureAllowed: false } } });
    expect(JSON.stringify(unknown.body)).not.toContain("Raj");

    const inbound = await post(router, "/api/sales/inbound", "owner-inbound", {
      callerPhone: "+919840099999", providerCallId: "demo-owner-1",
    });
    expect(inbound.status).toBe(200);
    expect(inbound.body).toMatchObject({ data: { resolution: { status: "RESOLVED", businessId, disclosureAllowed: false } } });
    const context = (inbound.body.data as { resolution: { context: { calls: Array<{ id: string; direction: string }> } } }).resolution.context;
    expect(context.calls.some((call) => call.direction === "OUTBOUND")).toBe(true);
    const ownerCall = context.calls.find((call) => call.direction === "INBOUND");
    expect(ownerCall).toBeDefined();

    const identified = await post(router, `${base}/contacts/${owner!.id}/identify`, "owner-identify", {
      name: "Raj", roles: ["OWNER"], isDecisionMaker: true, preferredLanguage: "TAMIL",
    });
    expect(identified.body).toMatchObject({ data: { verified: true, isDecisionMaker: true } });

    const won = await post(router, `${base}/deal-won`, "journey-won", {
      callId: ownerCall!.id, decisionMakerContactId: owner!.id,
      summary: "Raj approved a mobile-first restaurant site with WhatsApp ordering.",
      publicBusinessPhone: "+91 44 4000 2222",
      objections: ["Needs simple updates"],
      requirements: { pages: ["Home", "Menu", "About", "Contact"], features: { whatsappOrdering: true, googleMaps: true }, notes: ["Tamil + English copy"] },
      branding: { style: "warm" }, quotedPrice: 8_000, agreedPrice: 7_500, language: "TAMIL",
    });
    expect(won.status).toBe(200);
    expect(won.body).toMatchObject({ data: { business: { salesState: "SPEC_GENERATED" }, memory: { agreedPrice: 7500 } } });

    const spec = await request(router, `${base}/project_spec.json`);
    expect(spec.status).toBe(200);
    expect(spec.body).toMatchObject({ data: {
      businessId, business: { phone: "+914440002222" }, contact: { name: "Raj" },
      requirements: { features: { whatsappOrdering: true } },
      commercial: { agreedPrice: 7500 },
    } });
    const salesDetail = await runtime.salesRepository.getDetail(businessId);
    expect(salesDetail).not.toBeNull();
    // Preserve an older SpiceRoute deployment with a different scope.
    const older = await runtime.store.findByBusinessAndCampaign(businessId, "campaign-stage-1-demo");
    expect(older).not.toBeNull();
    await runtime.store.save({ ...older!, lead: { ...older!.lead, status: "DEPLOYED", version: older!.lead.version + 1, updatedAt: new Date().toISOString() } });
    const delivery = await runtime.orchestrator.handoffSalesSpecification(salesDetail!, "campaign-stage-1-demo");
    expect(delivery).toMatchObject({ lead: { status: "SPEC_GENERATED" }, deal: { finalAmount: 7500 },
      project: { specification: { business: { phone: "+914440002222" } } } });
    expect(delivery.project?.specification?.business.phone).not.toBe("+919840099999");
    expect(delivery.lead.id).not.toBe(older!.lead.id);
    expect(delivery.campaign.id).toBe(`sales-spec-${salesDetail!.projectSpec!.id}`);
    expect((await runtime.orchestrator.handoffSalesSpecification(salesDetail!, "campaign-stage-1-demo")).lead.id).toBe(delivery.lead.id);
    const deployed = await runtime.orchestrator.run(delivery.lead.id);
    expect(deployed).toMatchObject({ lead: { status: "DEPLOYED" }, deployment: { providerMode: "DEMO", status: "DEPLOYED" } });
    await runtime.close();
    await rm(outputRoot, { recursive: true, force: true });
  });

  it("requires founder authentication and permanently blocks outreach after opt-out", async () => {
    const environment = { DEMO_MODE: "true", TELEPHONY_PROVIDER: "demo", AGENTFRONT_API_TOKEN: "founder-test-token" };
    const runtime = createRuntime(environment);
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const base = "/api/sales/businesses/business-spiceroute";
    expect((await request(router, "/api/sales/overview")).status).toBe(401);
    const headers = { authorization: "Bearer founder-test-token", "idempotency-key": "dnc-1" };
    const dnc = await request(router, `${base}/do-not-contact`, { method: "POST", headers, body: { reason: "Business opted out." } });
    expect(dnc.body).toMatchObject({ data: { business: { salesState: "DO_NOT_CONTACT" } } });
    const call = await request(router, `${base}/call`, { method: "POST", headers: { ...headers, "idempotency-key": "dnc-call" }, body: { allowDemoOutsideWindow: true } });
    expect(call.status).toBe(409);
    expect(call.body).toMatchObject({ error: { code: "DO_NOT_CONTACT" } });
    await runtime.close();
  });

  it("requires founder approval and sends the selected Google Places phone to Sarvam", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T06:00:00.000Z")); // 11:30 Asia/Kolkata

    const selectedPhone = "+91 98400 12999";
    const normalizedSelectedPhone = "+919840012999";
    const demoBusinessPhone = "+919876543210";
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/api/health")
        ? new Response(JSON.stringify({ ok: true, data: { service: "agentfront-api", status: "ok" } }), { status: 200 })
        : new Response(JSON.stringify({ attempt_id: "attempt-google-client-001" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const environment: NodeJS.ProcessEnv = {
      DEMO_MODE: "false",
      GOOGLE_PLACES_API_KEY: "google-places-test-key",
      WEB_ORIGIN: "http://localhost:3000",
      AGENTFRONT_API_TOKEN: "founder-test-token",
      TELEPHONY_PROVIDER: "sarvam",
      SARVAM_API_KEY: "sarvam-test-key",
      SARVAM_ORG_ID: "org-agentfront",
      SARVAM_WORKSPACE_ID: "workspace-sales",
      SARVAM_SALES_APP_ID: "app-sales",
      SARVAM_SALES_APP_VERSION: "1",
      SARVAM_CONNECTION_ID: "connection-vobiz",
      SARVAM_AGENT_PHONE_NUMBER: "+914400000000",
      SARVAM_WEBHOOK_TOKEN: "sarvam-webhook-token-long-enough",
      SARVAM_OUTBOUND_WEBHOOK_URL: "https://api.agentfront.example/api/webhooks/sarvam/outbound?token=sarvam-webhook-token-long-enough",
      SARVAM_ALLOWED_BUSINESS_ID: "business-spiceroute",
      DEMO_BUSINESS_PHONE: demoBusinessPhone,
      SARVAM_ALLOW_DISCOVERED_DESTINATIONS: "true",
    };
    const runtime = createRuntime(environment);
    const seed = await runtime.store.getBusiness("business-spiceroute");
    if (!seed) throw new Error("The test seed is missing.");
    const businessId = "google-place-client";
    await runtime.store.upsertBusinesses([{
      ...seed,
      id: businessId,
      externalPlaceId: "places-real-client",
      name: "Real Client Restaurant",
      phone: selectedPhone,
      source: "GOOGLE_PLACES",
    }]);
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const base = `/api/sales/businesses/${businessId}`;
    const authenticated = { authorization: "Bearer founder-test-token" };

    const queued = await request(router, `${base}/queue`, {
      method: "POST",
      headers: { ...authenticated, "idempotency-key": "google-client-queue" },
      body: { campaignId: "campaign-stage-1-demo" },
    });
    expect(queued.status).toBe(202);

    const unapproved = await request(router, `${base}/call`, {
      method: "POST",
      headers: { ...authenticated, "idempotency-key": "google-client-call-unapproved" },
      body: { campaignId: "campaign-stage-1-demo" },
    });
    expect(unapproved.status).toBe(409);
    expect(unapproved.body).toMatchObject({ error: { code: "FOUNDER_APPROVAL_REQUIRED" } });
    expect(fetchMock).not.toHaveBeenCalled();

    const mismatched = await request(router, `${base}/call`, {
      method: "POST",
      headers: { ...authenticated, "idempotency-key": "google-client-call-mismatched" },
      body: { campaignId: "campaign-stage-1-demo", founderApproved: true, approvedPhone: "+91 98400 12001" },
    });
    expect(mismatched.status).toBe(409);
    expect(mismatched.body).toMatchObject({ error: { code: "FOUNDER_APPROVAL_REQUIRED" } });
    expect(fetchMock).not.toHaveBeenCalled();

    const approved = await request(router, `${base}/call`, {
      method: "POST",
      headers: { ...authenticated, "idempotency-key": "google-client-call-approved" },
      body: { campaignId: "campaign-stage-1-demo", founderApproved: true, approvedPhone: selectedPhone },
    });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({
      data: {
        mode: "REAL",
        call: {
          businessId, providerCallId: "attempt-google-client-001", providerMode: "REAL", status: "INITIATING",
        },
      },
    });

    const outbound = fetchMock.mock.calls.find(([input]) => String(input).includes("/outbounds"));
    expect(outbound).toBeDefined();
    const [, init] = outbound as unknown as [string | URL | Request, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      app_config: { agent_variables: Record<string, string> };
      user_config: { user_phone_number: string };
    };
    expect(payload.user_config.user_phone_number).toBe(normalizedSelectedPhone);
    expect(payload.user_config.user_phone_number).not.toBe(demoBusinessPhone);
    expect(payload.app_config.agent_variables).toEqual({
      business_id: businessId,
      business_name: "Real Client Restaurant",
      category: "restaurant",
      location: seed.address,
      package_name: "Restaurant website package",
      target_price: "5999",
      floor_price: "5999",
      currency: "INR",
    });
    await runtime.close();
  });
});
