import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter } from "./router";
import { createRuntime } from "./runtime";

type Router = ReturnType<typeof createRouter>;

interface TestResponse {
  status: number;
  header(name: string): string | undefined;
  body: Record<string, unknown>;
}

function createTestRouter(overrides: NodeJS.ProcessEnv = {}, bindHost = "127.0.0.1"): Router {
  const environment: NodeJS.ProcessEnv = {
    DEMO_MODE: "true",
    WEB_ORIGIN: "http://localhost:3000",
    ...overrides,
  };
  return createRouter(createRuntime(environment), { environment, bindHost });
}

async function request(
  router: Router,
  pathname: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: unknown } = {},
): Promise<TestResponse> {
  const serializedBody = options.body === undefined ? [] : [JSON.stringify(options.body)];
  const incoming = Readable.from(serializedBody) as IncomingMessage;
  Object.assign(incoming, {
    method: options.method ?? "GET",
    url: pathname,
    headers: Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    ),
  });

  let status = 0;
  let responseBody = "";
  const headers = new Map<string, string>();
  const outgoing = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
      return this;
    },
    writeHead(statusCode: number, values?: Record<string, string | number>) {
      status = statusCode;
      for (const [name, value] of Object.entries(values ?? {})) headers.set(name.toLowerCase(), String(value));
      return this;
    },
    write(chunk: unknown) {
      responseBody += String(chunk ?? "");
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) responseBody += String(chunk);
      return this;
    },
  } as unknown as ServerResponse;

  await router(incoming, outgoing);
  return {
    status,
    header: (name) => headers.get(name.toLowerCase()),
    body: responseBody ? JSON.parse(responseBody) as Record<string, unknown> : {},
  };
}

describe("API access guard", () => {
  it("reports the environment emergency stop in local preview without requiring a database", async () => {
    const router = createTestRouter({ GLOBAL_EMERGENCY_STOP: "true" });
    const control = await request(router, "/api/control/emergency-stop");
    expect(control.body).toMatchObject({ data: { stopped: true } });
    const dashboard = await request(router, "/api/dashboard");
    expect(dashboard.body).toMatchObject({ data: { emergencyStopped: true } });
  });

  it("blocks a founder-triggered sales call while the global emergency stop is active", async () => {
    const router = createTestRouter({ GLOBAL_EMERGENCY_STOP: "true" });
    const base = "/api/sales/businesses/business-spiceroute";
    const queued = await request(router, `${base}/queue`, {
      method: "POST",
      headers: { "idempotency-key": "emergency-stop-queue" },
      body: { campaignId: "campaign-stage-1-demo" },
    });
    expect(queued.status).toBe(202);

    const call = await request(router, `${base}/call`, {
      method: "POST",
      headers: { "idempotency-key": "emergency-stop-call" },
      body: { campaignId: "campaign-stage-1-demo", allowDemoOutsideWindow: true },
    });
    expect(call.status).toBe(409);
    expect(call.body).toMatchObject({ error: { code: "EMERGENCY_STOPPED" } });
  });

  it("keeps payment state honest when durable Dodo test mode is not configured", async () => {
    const router = createTestRouter();
    const status = await request(router, "/api/demo/spiceroute/payment");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      data: { mode: "TEST", status: "NOT_STARTED", configured: false, paymentId: null },
    });

    const checkout = await request(router, "/api/demo/spiceroute/checkout", {
      method: "POST",
      headers: { "idempotency-key": "spiceroute_test_1" },
      body: { email: "owner@example.com" },
    });
    expect(checkout.status).toBe(503);
    expect(checkout.body).toMatchObject({ error: { code: "PAYMENTS_UNAVAILABLE" } });
  });

  it("allows the Dodo webhook boundary through founder auth but still requires provider verification", async () => {
    const router = createTestRouter({ AGENTFRONT_API_TOKEN: "unit-test-secret" });
    const webhook = await request(router, "/api/webhooks/dodo-test", {
      method: "POST",
      body: { type: "payment.succeeded" },
    });
    expect(webhook.status).toBe(503);
    expect(webhook.body).toMatchObject({ error: { code: "PAYMENTS_UNAVAILABLE" } });
  });

  it("reports worker heartbeat separately from API and job storage health", async () => {
    const environment = { DEMO_MODE: "true", WEB_ORIGIN: "http://localhost:3000" };
    const runtime = createRuntime(environment);
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const absent = await request(router, "/api/integrations/health");
    expect(absent.body).toMatchObject({ data: { integrations: expect.arrayContaining([
      expect.objectContaining({ integration: "scheduler", status: "NOT_CONFIGURED" }),
    ]) } });
    await runtime.salesRepository.recordWorkerHeartbeat("unit-worker", new Date().toISOString());
    const refreshed = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const healthy = await request(refreshed, "/api/integrations/health");
    expect(healthy.body).toMatchObject({ data: { integrations: expect.arrayContaining([
      expect.objectContaining({ integration: "scheduler", status: "CONNECTED" }),
      expect.objectContaining({ integration: "jobQueue", status: "DEMO" }),
    ]) } });
    await runtime.close();
  });
  it("keeps cheap liveness public and protects detailed health and commands", async () => {
    const router = createTestRouter({ AGENTFRONT_API_TOKEN: "unit-test-secret" });

    const health = await request(router, "/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ data: { service: "agentfront-api", status: "ok" } });

    const protectedHealth = await request(router, "/api/integrations/health");
    expect(protectedHealth.status).toBe(401);

    const missing = await request(router, "/api/campaigns");
    expect(missing.status).toBe(401);
    expect(missing.header("www-authenticate")).toContain("Bearer");
    expect(missing.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    const wrong = await request(router, "/api/campaigns", {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status).toBe(401);

    const allowed = await request(router, "/api/campaigns", {
      headers: { authorization: "Bearer unit-test-secret" },
    });
    expect(allowed.status).toBe(200);

    const detailedHealth = await request(router, "/api/integrations/health", {
      headers: { authorization: "Bearer unit-test-secret" },
    });
    expect(detailedHealth.body).toMatchObject({
      data: { persistence: { mode: "IN_MEMORY", durable: false, status: "DEMO" } },
    });
  });

  it("allows token-free loopback development but fails closed on a non-loopback bind", async () => {
    expect((await request(createTestRouter(), "/api/campaigns")).status).toBe(200);

    const exposedRouter = createTestRouter({}, "0.0.0.0");
    expect((await request(exposedRouter, "/api/health")).status).toBe(200);
    const unavailable = await request(exposedRouter, "/api/campaigns");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toMatchObject({ error: { code: "AUTH_NOT_CONFIGURED" } });
  });

  it("requires authentication in production even on loopback unless the demo bypass is explicit", async () => {
    const production = createTestRouter({ NODE_ENV: "production" });
    expect((await request(production, "/api/campaigns")).body)
      .toMatchObject({ error: { code: "AUTH_NOT_CONFIGURED" } });

    const explicitDemo = createTestRouter({
      NODE_ENV: "production",
      ALLOW_UNAUTHENTICATED_LOOPBACK_DEMO: "true",
    });
    expect((await request(explicitDemo, "/api/campaigns")).status).toBe(200);
  });

  it("exchanges the founder token for an HttpOnly session cookie without browser token storage", async () => {
    const router = createTestRouter({
      AGENTFRONT_API_TOKEN: "unit-test-secret",
      AGENTFRONT_SESSION_SECRET: "separate-session-signing-secret",
    });

    const before = await request(router, "/api/auth/session");
    expect(before.body).toMatchObject({ data: { required: true, authenticated: false, mode: "SESSION" } });

    const rejected = await request(router, "/api/auth/session", {
      method: "POST",
      body: { token: "wrong-secret" },
    });
    expect(rejected.status).toBe(401);

    const login = await request(router, "/api/auth/session", {
      method: "POST",
      body: { token: "unit-test-secret" },
    });
    expect(login.status).toBe(200);
    expect(login.header("set-cookie")).toContain("HttpOnly");
    expect(login.header("set-cookie")).toContain("SameSite=Strict");
    expect(login.header("set-cookie")).not.toContain("unit-test-secret");

    const withSession = await request(router, "/api/campaigns", {
      headers: { cookie: login.header("set-cookie") },
    });
    expect(withSession.status).toBe(200);
  });

  it("coalesces and caches authenticated provider diagnostics", async () => {
    const environment: NodeJS.ProcessEnv = { DEMO_MODE: "true", AGENTFRONT_HEALTH_TTL_MS: "60000" };
    const runtime = createRuntime(environment);
    const placesHealth = vi.spyOn(runtime.providers.places, "health");
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });

    await request(router, "/api/health");
    expect(placesHealth).not.toHaveBeenCalled();
    await Promise.all([
      request(router, "/api/integrations/health"),
      request(router, "/api/integrations/health"),
    ]);
    await request(router, "/api/integrations/health");
    expect(placesHealth).toHaveBeenCalledTimes(1);
    await runtime.close();
  });
});

describe("API command validation", () => {
  it("hydrates the durable control-center projection in one request", async () => {
    const router = createTestRouter();
    const dashboard = await request(router, "/api/dashboard");

    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toMatchObject({
      data: {
        metrics: expect.any(Object),
        campaigns: [expect.objectContaining({ id: "campaign-stage-1-demo", status: "RUNNING" })],
        leads: expect.any(Array),
        events: expect.any(Array),
      },
    });
  });

  it("exposes a labelled CRM adapter projection without static portfolio records", async () => {
    const router = createTestRouter();
    const response = await request(router, "/api/crm/deals");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: {
        mode: "DEMO",
        provider: "AgentFront Demo CRM",
        consoleUrl: null,
        deals: [],
      },
    });
  });

  it("allowlists campaign identifiers and actions", async () => {
    const router = createTestRouter();

    const invalidId = await request(router, "/api/campaigns/bad%20campaign/pause", { method: "POST" });
    expect(invalidId.status).toBe(400);
    expect(invalidId.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const unsupportedAction = await request(router, "/api/campaigns/campaign-stage-1-demo/delete", { method: "POST" });
    expect(unsupportedAction.status).toBe(404);

    const valid = await request(router, "/api/campaigns/campaign-stage-1-demo/pause", { method: "POST" });
    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({ data: { status: "PAUSED" } });
  });

  it("removes obsolete compatibility endpoints", async () => {
    const router = createTestRouter();

    expect((await request(router, "/api/businesses")).status).toBe(404);
    expect((await request(router, "/api/demo/run", { method: "POST", body: {} })).status).toBe(404);
    expect((await request(router, "/api/stream")).status).toBe(404);
  });

  it("rejects malformed discovery and event query parameters", async () => {
    const router = createTestRouter();
    const invalidQueries = [
      "/api/discover?radiusMetres=100.5",
      "/api/discover?websitePresence=UNKNOWN",
      "/api/discover?minimumRating=6",
      "/api/discover?minimumReviewCount=-1",
      "/api/discover?location=" + "x".repeat(201),
      "/api/events?limit=NaN",
      "/api/events?limit=501",
    ];

    for (const pathname of invalidQueries) {
      const response = await request(router, pathname);
      expect(response.status, pathname).toBe(400);
      expect(response.body, pathname).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  it("bounds pipeline idempotency keys before starting work", async () => {
    const router = createTestRouter();
    const response = await request(router, "/api/pipeline/start", {
      method: "POST",
      headers: { "idempotency-key": "x".repeat(129) },
      body: {},
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("fails startup for weak production secrets and non-origin WEB_ORIGIN values", () => {
    expect(() => createTestRouter({ NODE_ENV: "production", AGENTFRONT_API_TOKEN: "short" })).toThrow(
      /AGENTFRONT_API_TOKEN/,
    );
    expect(() => createTestRouter({
      NODE_ENV: "production",
      AGENTFRONT_API_TOKEN: "a".repeat(32),
      AGENTFRONT_SESSION_SECRET: "short",
    })).toThrow(/AGENTFRONT_SESSION_SECRET/);
    expect(() => createTestRouter({ WEB_ORIGIN: "http://localhost:3000/path" })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects unallowlisted conversation outcome fields before orchestration", async () => {
    const router = createTestRouter();
    const at = "2026-08-23T10:00:00.000Z";
    const response = await request(router, "/api/leads/lead-AF-2026-999999/conversation/complete", {
      method: "POST",
      headers: { "idempotency-key": "conversation-test" },
      body: {
        outcome: {
          transcript: [{ id: "turn-1", speaker: "CUSTOMER", text: "Please proceed.", at }],
          summary: "Approved scope.",
          sentiment: "POSITIVE",
          requirements: {
            businessType: "restaurant",
            pages: ["Home", "Contact"],
            features: { whatsappOrdering: true, shellCommand: true },
            branding: { style: "modern", primaryColour: null, mobileFirst: true },
            contentRequirements: [],
            budget: { minimum: 6_000, maximum: 8_000, currency: "INR" },
            notes: [],
            approvedAt: at,
          },
          acceptedAmount: 7_200,
        },
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});

describe("REAL browser conversation security", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues ephemeral consent-gated access, binds the SDK ID, and governs completion", async () => {
    const environment: NodeJS.ProcessEnv = {
      DEMO_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      AGENTFRONT_API_TOKEN: "agentfront-api-test-token",
      ELEVENLABS_API_KEY: "elevenlabs-server-only-key",
      ELEVENLABS_AGENT_ID: "agent-secure-test",
      ELEVENLABS_TOOL_SECRET: "elevenlabs-post-call-tool-secret",
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/conversation/get-signed-url")) {
        return new Response(JSON.stringify({
          signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=secret-signed-value",
        }), { status: 200 });
      }
      if (url.includes("/convai/conversations/")) {
        return new Response(JSON.stringify({
          agent_id: "agent-secure-test",
          status: "in-progress",
          transcript: [],
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createRuntime(environment);
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const business = await runtime.store.getBusiness("business-spiceroute");
    const campaign = await runtime.store.getCampaign("campaign-stage-1-demo");
    if (!business || !campaign) throw new Error("The test seed is missing.");
    const enrolled = await runtime.orchestrator.start({ business, campaign, idempotencyKey: "real-browser-test" });
    const route = `/api/leads/${enrolled.lead.id}/conversation/session`;
    const apiHeaders = { authorization: "Bearer agentfront-api-test-token" };

    const unauthorized = await request(router, route, {
      method: "POST",
      body: { consent: { microphone: true, transcript: true }, idempotencyKey: "session-1" },
    });
    expect(unauthorized.status).toBe(401);

    const wrongState = await request(router, route, {
      method: "POST",
      headers: apiHeaders,
      body: { consent: { microphone: true, transcript: true }, idempotencyKey: "session-1" },
    });
    expect(wrongState.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();

    const active = await runtime.orchestrator.run(enrolled.lead.id);
    expect(active).toMatchObject({
      lead: { status: "CONVERSATION_ACTIVE" },
      conversation: {
        providerMode: "REAL",
        providerConversationId: `pending-${enrolled.lead.projectId}`,
        clientToken: null,
        providerUrl: null,
        status: "PENDING",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const missingConsent = await request(router, route, {
      method: "POST",
      headers: apiHeaders,
      body: { consent: { microphone: true, transcript: false }, idempotencyKey: "session-1" },
    });
    expect(missingConsent.status).toBe(400);
    expect(missingConsent.body).toMatchObject({ error: { code: "CONVERSATION_CONSENT_REQUIRED" } });

    const oversizedKey = await request(router, route, {
      method: "POST",
      headers: { ...apiHeaders, "idempotency-key": "x".repeat(129) },
      body: { consent: { microphone: true, transcript: true } },
    });
    expect(oversizedKey.status).toBe(400);

    const session = await request(router, route, {
      method: "POST",
      headers: { ...apiHeaders, "idempotency-key": "session-1" },
      body: { consent: { microphone: true, transcript: true } },
    });
    expect(session.status).toBe(201);
    expect(session.header("cache-control")).toBe("no-store");
    expect(session.body).toMatchObject({
      data: {
        mode: "REAL",
        logicalConversationId: `conversation-${enrolled.lead.projectId}`,
        signedUrl: expect.stringMatching(/^wss:\/\/api\.elevenlabs\.io\//),
      },
      meta: { replayed: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const replay = await request(router, route, {
      method: "POST",
      headers: { ...apiHeaders, "idempotency-key": "session-1" },
      body: { consent: { microphone: true, transcript: true } },
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ data: { grantId: (session.body.data as { grantId: string }).grantId }, meta: { replayed: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const aggregateBeforeConnect = await request(router, `/api/leads/${enrolled.lead.id}`, {
      headers: apiHeaders,
    });
    expect(JSON.stringify(aggregateBeforeConnect.body)).not.toContain("secret-signed-value");
    expect(aggregateBeforeConnect.body).toMatchObject({
      data: { conversation: { clientToken: null, providerUrl: null } },
    });

    const grantId = (session.body.data as { grantId: string }).grantId;
    const invalidProviderId = await request(router, `/api/leads/${enrolled.lead.id}/conversation/connect`, {
      method: "POST",
      headers: apiHeaders,
      body: { grantId, providerConversationId: "pending-forged", idempotencyKey: "connect-1" },
    });
    expect(invalidProviderId.status).toBe(400);

    const providerConversationId = "conv_sdk_actual_123";
    const connected = await request(router, `/api/leads/${enrolled.lead.id}/conversation/connect`, {
      method: "POST",
      headers: { ...apiHeaders, "idempotency-key": "connect-1" },
      body: { grantId, providerConversationId },
    });
    expect(connected.status).toBe(200);
    expect(connected.body).toMatchObject({
      data: {
        conversation: {
          providerConversationId,
          status: "ACTIVE",
          clientToken: null,
          providerUrl: null,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const at = "2026-08-23T10:00:00.000Z";
    const outcome = {
      transcript: [{ id: "turn-real-1", speaker: "CUSTOMER", text: "Please proceed.", at }],
      summary: "The owner approved the server-governed scope.",
      sentiment: "POSITIVE",
      requirements: {
        businessType: "restaurant",
        pages: ["Home", "Menu", "Contact"],
        features: { menu: true, whatsappOrdering: true, googleMaps: true },
        branding: { style: "modern", primaryColour: null, mobileFirst: true },
        contentRequirements: [],
        budget: { minimum: 6_000, maximum: 8_000, currency: "INR" },
        notes: [],
        approvedAt: at,
      },
      acceptedAmount: 7_200,
    };
    await runtime.store.updateCampaignStatus(campaign.id, "PAUSED");

    const apiTokenIsNotToolAuth = await request(router, `/api/leads/${enrolled.lead.id}/conversation/complete`, {
      method: "POST",
      headers: { authorization: "Bearer agentfront-api-test-token", "idempotency-key": "complete-1" },
      body: { providerConversationId, outcome },
    });
    expect(apiTokenIsNotToolAuth.status).toBe(401);
    expect(apiTokenIsNotToolAuth.body).toMatchObject({ error: { code: "UNAUTHORIZED_CONVERSATION_TOOL" } });

    const mismatch = await request(router, `/api/leads/${enrolled.lead.id}/conversation/complete`, {
      method: "POST",
      headers: { authorization: "Bearer elevenlabs-post-call-tool-secret", "idempotency-key": "complete-1" },
      body: { providerConversationId: "conv_different", outcome },
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ error: { code: "CONVERSATION_CORRELATION_MISMATCH" } });

    const completed = await request(router, `/api/leads/${enrolled.lead.id}/conversation/complete`, {
      method: "POST",
      headers: { authorization: "Bearer elevenlabs-post-call-tool-secret", "idempotency-key": "complete-1" },
      body: { providerConversationId, outcome },
    });
    expect(completed.status).toBe(202);
    expect(completed.body).toMatchObject({
      data: {
        lead: { status: "REQUIREMENTS_COLLECTED" },
        conversation: { providerConversationId, status: "COMPLETED", clientToken: null, providerUrl: null },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await runtime.close();
  });
});
