import { describe, expect, it, vi } from "vitest";
import {
  createDemoWebhookSignature,
  createTelephonyProvider,
  DemoTelephonyProvider,
  SarvamVobizTelephonyProvider,
  TelephonyUnavailableError,
  UnavailableTelephonyProvider,
  type DemoInboundWebhookPayload,
  type TelephonyWebhookRequest,
} from "./telephony";

const FIXED_NOW = "2026-09-18T06:30:00.000Z";
const clock = () => new Date(FIXED_NOW);

function demoWebhook(payload: DemoInboundWebhookPayload | string): TelephonyWebhookRequest {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-agentfront-demo-signature": createDemoWebhookSignature(rawBody),
    },
  };
}

const inboundPayload: DemoInboundWebhookPayload = {
  event: "call.inbound",
  eventId: "evt-0001",
  providerCallId: "provider-call-0001",
  from: "+91 98400 12001",
  to: "+91 44000 00000",
  occurredAt: FIXED_NOW,
};

describe("DemoTelephonyProvider", () => {
  it("is clearly marked DEMO and deterministically places and terminates a simulated call", async () => {
    const provider = new DemoTelephonyProvider(clock);
    const call = await provider.makeOutboundCall(
      {
        businessId: "business-spiceroute",
        contactId: "contact-owner",
        to: "+91 98400 12001",
      },
      "call-spiceroute-owner-1",
    );

    expect(call).toMatchObject({
      id: expect.stringMatching(/^tel_call_demo_[a-f0-9]{24}$/),
      providerCallId: expect.stringMatching(/^demo_call_[a-f0-9]{24}$/),
      provider: "demo",
      mode: "DEMO",
      direction: "OUTBOUND",
      businessId: "business-spiceroute",
      contactId: "contact-owner",
      calleePhone: "+919840012001",
      status: "RINGING",
      startedAt: FIXED_NOW,
      endedAt: null,
    });
    await expect(provider.health()).resolves.toMatchObject({
      integration: "telephony",
      mode: "DEMO",
      status: "DEMO",
      message: expect.stringContaining("SIMULATED TELEPHONY"),
    });

    const terminated = await provider.terminateCall(call.id);
    expect(terminated).toMatchObject({ status: "TERMINATED", endedAt: FIXED_NOW });
    await expect(provider.terminateCall(call.id)).resolves.toEqual(terminated);
  });

  it("parses a verified inbound webhook, returns caller identity, and deduplicates provider events", async () => {
    const provider = new DemoTelephonyProvider(clock);
    const request = demoWebhook(inboundPayload);

    await expect(provider.verifyWebhook(request)).resolves.toBe(true);
    const first = await provider.parseInboundWebhook(request);
    const duplicate = await provider.parseInboundWebhook(request);

    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({
      id: expect.stringMatching(/^tel_event_demo_[a-f0-9]{24}$/),
      callId: expect.stringMatching(/^tel_call_demo_[a-f0-9]{24}$/),
      type: "CALL_INBOUND",
      direction: "INBOUND",
      callerPhone: "+919840012001",
      calledPhone: "+914400000000",
      occurredAt: FIXED_NOW,
    });
    expect(provider.getCallerPhone(first)).toBe("+919840012001");
  });

  it("returns the same call for duplicate idempotency keys and rejects conflicting reuse", async () => {
    const provider = new DemoTelephonyProvider(clock);
    const request = { businessId: "business-1", to: "+919840012001" };
    const first = await provider.makeOutboundCall(request, "stable-key");
    const duplicate = await provider.makeOutboundCall(request, "stable-key");

    expect(duplicate).toEqual(first);
    await expect(
      provider.makeOutboundCall({ ...request, to: "+919840012002" }, "stable-key"),
    ).rejects.toThrow(/different outbound call/i);
  });

  it("rejects malformed, unsigned, oversized, and conflicting inbound events", async () => {
    const provider = new DemoTelephonyProvider(clock);

    await expect(provider.parseInboundWebhook(demoWebhook("{not-json"))).rejects.toThrow(/valid JSON/i);
    await expect(provider.parseInboundWebhook({
      rawBody: JSON.stringify(inboundPayload),
      headers: { "content-type": "application/json" },
    })).rejects.toThrow(/verification failed/i);
    await expect(provider.verifyWebhook({
      rawBody: "x".repeat(65_537),
      headers: {
        "content-type": "application/json",
        "x-agentfront-demo-signature": `sha256=${"a".repeat(64)}`,
      },
    })).resolves.toBe(false);

    await provider.parseInboundWebhook(demoWebhook(inboundPayload));
    await expect(provider.parseInboundWebhook(demoWebhook({
      ...inboundPayload,
      from: "+919840012002",
    }))).rejects.toThrow(/event ID was already used/i);
  });
});

describe("UnavailableTelephonyProvider", () => {
  it.each(["exotel", "twilio", "vobiz"] as const)(
    "reports %s as unavailable and never fakes a successful operation",
    async (providerName) => {
      const provider = new UnavailableTelephonyProvider(providerName, undefined, clock);
      await expect(provider.health()).resolves.toMatchObject({
        mode: "REAL",
        status: "UNAVAILABLE",
      });
      await expect(provider.makeOutboundCall(
        { businessId: "business-1", to: "+919840012001" },
        "attempt-1",
      )).rejects.toBeInstanceOf(TelephonyUnavailableError);
      await expect(provider.terminateCall("tel_call_missing")).rejects.toBeInstanceOf(TelephonyUnavailableError);
      await expect(provider.verifyWebhook(demoWebhook(inboundPayload))).rejects.toBeInstanceOf(
        TelephonyUnavailableError,
      );
      await expect(provider.parseInboundWebhook(demoWebhook(inboundPayload))).rejects.toBeInstanceOf(
        TelephonyUnavailableError,
      );
    },
  );

  it("selects demo only when explicitly configured and otherwise fails closed", async () => {
    expect(createTelephonyProvider({ TELEPHONY_PROVIDER: " demo " })).toBeInstanceOf(DemoTelephonyProvider);

    for (const environment of [
      {},
      { TELEPHONY_PROVIDER: "twilio" },
      { TELEPHONY_PROVIDER: "carrier-with-a-typo" },
    ]) {
      const provider = createTelephonyProvider(environment);
      expect(provider).toBeInstanceOf(UnavailableTelephonyProvider);
      await expect(provider.health()).resolves.toMatchObject({ status: "UNAVAILABLE" });
    }

    expect(createTelephonyProvider({}).provider).toBeNull();
    expect(createTelephonyProvider({ TELEPHONY_PROVIDER: "twilio" }).provider).toBe("twilio");
  });
});

describe("SarvamVobizTelephonyProvider", () => {
  const configuration = {
    apiKey: "server-only-sarvam-key",
    orgId: "org-agentfront",
    workspaceId: "workspace-sales",
    appId: "app-spiceroute-sales",
    appVersion: 3,
    connectionId: "connection-vobiz",
    agentPhoneNumber: "+914400000000",
    webhookUrl: "https://api.agentfront.example/api/webhooks/sarvam/outbound/demo-token",
    allowedBusinessId: "business-spiceroute",
    allowedDestination: "+919876543210",
  };

  const callbackHealthResponse = () => new Response(JSON.stringify({
    ok: true,
    data: { service: "agentfront-api", status: "ok" },
  }), { status: 200 });

  it("places a Sarvam Instant Outbound call only to the configured consented number", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith("/api/health")
      ? callbackHealthResponse()
      : new Response(JSON.stringify({ attempt_id: "attempt-001" }), { status: 200 }));
    const provider = new SarvamVobizTelephonyProvider(configuration, { fetch: fetchMock as typeof fetch, clock });
    const call = await provider.makeOutboundCall({
      businessId: "business-spiceroute",
      contactId: "contact-owner",
      // This is illustrative seeded data and must never become the real target.
      to: "+919840012001",
      metadata: { salesCallId: "sales-call-1" },
    }, "sales-call-key");

    expect(call).toMatchObject({
      provider: "sarvam",
      providerCallId: "attempt-001",
      mode: "REAL",
      calleePhone: "+919876543210",
      callerPhone: "+914400000000",
      status: "INITIATING",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const outbound = fetchMock.mock.calls.find(([input]) => String(input).includes("/outbounds"));
    expect(outbound).toBeDefined();
    const [url, init] = outbound as unknown as [string, RequestInit];
    expect(url).toBe("https://apps.sarvam.ai/api/outbounds/v1/orgs/org-agentfront/workspaces/workspace-sales/outbounds");
    expect(init.headers).toMatchObject({ "X-API-Key": "server-only-sarvam-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      app_config: {
        app_id: "app-spiceroute-sales",
        app_version: 3,
        connection_config: { connection_id: "connection-vobiz", agent_phone_number: "+914400000000" },
      },
      user_config: { user_phone_number: "+919876543210" },
      webhook_config: {
        url: configuration.webhookUrl,
        metadata: { business_id: "business-spiceroute", contact_id: "contact-owner", salesCallId: "sales-call-1" },
      },
    });
  });

  it("uses the requested business number only when discovered destinations are explicitly enabled", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith("/api/health")
      ? callbackHealthResponse()
      : new Response(JSON.stringify({ attempt_id: "attempt-discovered-001" }), { status: 200 }));
    const provider = new SarvamVobizTelephonyProvider({
      ...configuration,
      allowDiscoveredDestinations: true,
    }, { fetch: fetchMock as typeof fetch, clock });

    const call = await provider.makeOutboundCall({
      businessId: "google-place-client",
      to: "+919840012001",
      founderApprovedDestination: "+91 98400 12001",
      metadata: { salesCallId: "sales-call-discovered" },
      agentVariables: {
        business_id: "google-place-client",
        business_name: "Marina Cafe",
        category: "restaurant",
        location: "Chennai",
      },
    }, "founder-approved-call");

    expect(call).toMatchObject({ businessId: "google-place-client", calleePhone: "+919840012001" });
    const outbound = fetchMock.mock.calls.find(([input]) => String(input).includes("/outbounds"));
    const [, init] = outbound as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      app_config: { app_type: "agent", agent_variables: {
        business_id: "google-place-client", business_name: "Marina Cafe",
        category: "restaurant", location: "Chennai",
      } },
      user_config: { user_phone_number: "+919840012001" },
      webhook_config: { metadata: { business_id: "google-place-client", salesCallId: "sales-call-discovered" } },
    });
  });

  it("fails closed when a discovered destination lacks an exact founder approval", async () => {
    const fetchMock = vi.fn();
    const provider = new SarvamVobizTelephonyProvider({
      ...configuration,
      allowDiscoveredDestinations: true,
    }, { fetch: fetchMock as typeof fetch, clock });

    await expect(provider.makeOutboundCall({
      businessId: "google-place-client",
      to: "+919840012001",
    }, "missing-founder-approval")).rejects.toThrow(/founder approval/i);

    await expect(provider.makeOutboundCall({
      businessId: "google-place-client",
      to: "+919840012001",
      founderApprovedDestination: "+919840012002",
    }, "mismatched-founder-approval")).rejects.toThrow(/founder approval/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for every business except the configured SpiceRoute demo", async () => {
    const fetchMock = vi.fn();
    const provider = new SarvamVobizTelephonyProvider(configuration, { fetch: fetchMock as typeof fetch, clock });
    await expect(provider.makeOutboundCall({
      businessId: "business-someone-else",
      to: "+919876543210",
    }, "wrong-business")).rejects.toThrow(/restricted to the configured business/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not dial when the public AgentFront callback is unreachable", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => { throw new Error("DNS failed"); });
    const provider = new SarvamVobizTelephonyProvider(configuration, { fetch: fetchMock as typeof fetch, clock });

    await expect(provider.health()).resolves.toMatchObject({ status: "DEGRADED", mode: "REAL" });
    await expect(provider.makeOutboundCall({
      businessId: "business-spiceroute",
      to: configuration.allowedDestination,
    }, "callback-down")).rejects.toThrow(/public AgentFront webhook is unreachable/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([input]) => String(input) === "https://api.agentfront.example/api/health")).toBe(true);
  });

  it("selects Sarvam only with a complete, safe server configuration", async () => {
    const fetchMock = vi.fn(async () => callbackHealthResponse());
    const provider = createTelephonyProvider({
      TELEPHONY_PROVIDER: "sarvam",
      SARVAM_API_KEY: configuration.apiKey,
      SARVAM_ORG_ID: configuration.orgId,
      SARVAM_WORKSPACE_ID: configuration.workspaceId,
      SARVAM_SALES_APP_ID: configuration.appId,
      SARVAM_SALES_APP_VERSION: String(configuration.appVersion),
      SARVAM_CONNECTION_ID: configuration.connectionId,
      SARVAM_AGENT_PHONE_NUMBER: configuration.agentPhoneNumber,
      SARVAM_OUTBOUND_WEBHOOK_URL: configuration.webhookUrl,
      SARVAM_ALLOWED_BUSINESS_ID: configuration.allowedBusinessId,
      DEMO_BUSINESS_PHONE: configuration.allowedDestination,
    }, { fetch: fetchMock as typeof fetch, clock });
    expect(provider).toBeInstanceOf(SarvamVobizTelephonyProvider);
    await expect(provider.health()).resolves.toMatchObject({ status: "CONNECTED", mode: "REAL" });

    const unavailable = createTelephonyProvider({ TELEPHONY_PROVIDER: "sarvam" });
    expect(unavailable).toBeInstanceOf(UnavailableTelephonyProvider);
    await expect(unavailable.health()).resolves.toMatchObject({ status: "UNAVAILABLE" });
  });

});
