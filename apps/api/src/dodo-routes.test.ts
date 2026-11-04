import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { handleDodoTestRoute, type DodoTestRoutes } from "./dodo-routes";

async function request(
  path: string,
  routes: DodoTestRoutes,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const incoming = Readable.from(options.body === undefined ? [] : [options.body]) as IncomingMessage;
  Object.assign(incoming, { method: options.method ?? "POST", headers: options.headers ?? {} });
  let status = 0;
  let text = "";
  const outgoing = {
    writeHead(code: number) { status = code; return this; },
    end(chunk?: unknown) { text += String(chunk ?? ""); return this; },
  } as unknown as ServerResponse;
  const handled = await handleDodoTestRoute(incoming, outgoing, path, routes);
  return { handled, status, body: text ? JSON.parse(text) as Record<string, unknown> : null };
}

const payment = {
  webhookId: "msg_spiceroute_1", paymentId: "pay_spiceroute_1", checkoutSessionId: "cks_spiceroute_1",
  projectId: "AF-2026-000001" as const, productId: "pdt_spiceroute_test", amountMinor: 720000,
  currency: "INR" as const, occurredAt: "2026-09-21T00:00:00.000Z", mode: "TEST" as const,
};

function routes(): DodoTestRoutes {
  const recorded = new Set<string>();
  return {
    createCheckoutOnce: vi.fn(async () => ({
      sessionId: "cks_spiceroute_1", checkoutUrl: "https://test.checkout.dodopayments.com/session/cks_spiceroute_1",
      projectId: "AF-2026-000001" as const, mode: "TEST" as const,
    })),
    verifyWebhook: vi.fn(() => payment),
    confirmPaymentOnce: vi.fn(async (verified) => {
      if (recorded.has(verified.webhookId)) return "duplicate";
      recorded.add(verified.webhookId);
      return "recorded";
    }),
  };
}

describe("Dodo test HTTP boundary", () => {
  it("requires an idempotency key and accepts only checkout customer fields", async () => {
    const deps = routes();
    const missing = await request("/api/demo/spiceroute/checkout", deps, { body: JSON.stringify({ email: "owner@example.com" }) });
    expect(missing.status).toBe(400);
    const arbitraryProduct = await request("/api/demo/spiceroute/checkout", deps, {
      headers: { "idempotency-key": "spiceroute_001" },
      body: JSON.stringify({ email: "owner@example.com", productId: "pdt_other" }),
    });
    expect(arbitraryProduct.status).toBe(400);
    expect(deps.createCheckoutOnce).not.toHaveBeenCalled();

    const checkout = await request("/api/demo/spiceroute/checkout", deps, {
      headers: { "idempotency-key": "spiceroute_001" },
      body: JSON.stringify({ email: "owner@example.com", name: "SpiceRoute owner" }),
    });
    expect(checkout.status).toBe(200);
    expect(deps.createCheckoutOnce).toHaveBeenCalledWith("spiceroute_001", { email: "owner@example.com", name: "SpiceRoute owner" });
    expect(checkout.body).toMatchObject({ data: { mode: "TEST" } });
  });

  it("passes raw webhook bytes to the verifier and relies on atomic persistence for duplicate events", async () => {
    const deps = routes();
    const first = await request("/api/webhooks/dodo-test", deps, { body: "{ \"signed\": true }" });
    const duplicate = await request("/api/webhooks/dodo-test", deps, { body: "{ \"signed\": true }" });
    expect(vi.mocked(deps.verifyWebhook).mock.calls[0]?.[0].toString("utf8")).toBe('{ "signed": true }');
    expect(first.body).toMatchObject({ data: { recorded: true, mode: "TEST" } });
    expect(duplicate.body).toMatchObject({ data: { recorded: false, mode: "TEST" } });
  });

  it("returns 5xx when durable payment processing fails so Dodo can retry", async () => {
    const deps = routes();
    deps.confirmPaymentOnce = vi.fn(async () => { throw new Error("database unavailable"); });
    const failed = await request("/api/webhooks/dodo-test", deps, { body: "{}" });
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ ok: false });
  });

  it("reports an unfinished SpiceRoute delivery as a retryable checkout conflict", async () => {
    const deps = routes();
    deps.createCheckoutOnce = vi.fn(async () => {
      throw Object.assign(new Error("SpiceRoute requires a won deal and deployed site before test checkout."), {
        code: "DEMO_DEAL_NOT_READY",
      });
    });
    const failed = await request("/api/demo/spiceroute/checkout", deps, {
      headers: { "idempotency-key": "spiceroute_002" },
      body: JSON.stringify({ email: "owner@example.com" }),
    });
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ error: { code: "DEMO_DEAL_NOT_READY" } });
  });

  it("never acknowledges an invalid signature", async () => {
    const deps = routes();
    deps.verifyWebhook = () => { throw Object.assign(new Error("bad signature"), { code: "INVALID_SIGNATURE" }); };
    const failed = await request("/api/webhooks/dodo-test", deps, { body: "{}" });
    expect(failed.status).toBe(401);
    expect(deps.confirmPaymentOnce).not.toHaveBeenCalled();
  });
});
