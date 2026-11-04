import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createDodoTestCheckout,
  dodoTestConfigFromEnv,
  verifyDodoTestWebhook,
  type DodoTestConfig,
} from "./dodo";

const now = new Date("2026-09-21T10:30:00.000Z");
const key = Buffer.alloc(32, 7);
const config: DodoTestConfig = {
  apiKey: "test_api_key",
  productId: "pdt_spiceroute_demo",
  webhookSecret: `whsec_${key.toString("base64")}`,
  businessId: "bus_test_spiceroute",
  expectedAmountMinor: 720000,
  currency: "INR",
  returnUrl: "https://agentfront.example/demo/payment-return",
  projectId: "AF-2026-000001",
};

function signed(body: unknown, id = "msg_test_001", timestamp = "1789986600") {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return { raw, headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` } };
}

const payment = {
  business_id: config.businessId,
  type: "payment.succeeded",
  timestamp: now.toISOString(),
  data: {
    business_id: config.businessId,
    payment_id: "pay_spiceroute_0001",
    checkout_session_id: "cks_spiceroute_0001",
    status: "succeeded",
    currency: "INR",
    total_amount: 720000,
    metadata: { agentfront_project_id: "AF-2026-000001", agentfront_mode: "TEST", agentfront_business: "spiceroute" },
    product_cart: [{ product_id: config.productId, quantity: 1 }],
  },
};

describe("Dodo test checkout", () => {
  it("fails closed unless test mode and bounded configuration are explicit", () => {
    expect(() => dodoTestConfigFromEnv({})).toThrow(/test_mode/);
    expect(() => dodoTestConfigFromEnv({ DODO_PAYMENTS_ENVIRONMENT: "live_mode" })).toThrow(/test_mode/);
    expect(() => dodoTestConfigFromEnv({
      DODO_PAYMENTS_ENVIRONMENT: "test_mode", DODO_PAYMENTS_API_KEY: "test",
      DODO_TEST_PRODUCT_ID: "pdt_1", DODO_PAYMENTS_WEBHOOK_KEY: config.webhookSecret,
      DODO_TEST_BUSINESS_ID: config.businessId, DODO_TEST_EXPECTED_AMOUNT_MINOR: "720000",
      DODO_TEST_RETURN_URL: "http://evil.example/return",
    })).toThrow(/HTTPS/);
  });

  it("only creates a hosted TEST checkout with server-selected product and project metadata", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      session_id: "cks_spiceroute_0001",
      checkout_url: "https://test.checkout.dodopayments.com/session/cks_spiceroute_0001",
    }), { status: 200 })) as unknown as typeof fetch;
    const result = await createDodoTestCheckout(config, { email: "owner@example.com", name: "Owner" }, fetcher);
    expect(result).toMatchObject({ mode: "TEST", projectId: "AF-2026-000001" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe("https://test.dodopayments.com/checkouts");
    const sent = JSON.parse(String(options?.body));
    expect(sent).toMatchObject({
      product_cart: [{ product_id: config.productId, quantity: 1 }],
      metadata: { agentfront_project_id: "AF-2026-000001", agentfront_mode: "TEST" },
    });
  });

  it("rejects a live checkout URL even if returned by the test endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      session_id: "cks_spiceroute_0001",
      checkout_url: "https://checkout.dodopayments.com/session/cks_spiceroute_0001",
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(createDodoTestCheckout(config, { email: "owner@example.com" }, fetcher)).rejects.toThrow(/valid test checkout/);
  });
});

describe("Dodo signed webhook", () => {
  it("verifies the exact raw body and accepts only the matching test payment", () => {
    const request = signed(payment);
    expect(verifyDodoTestWebhook(config, request.raw, request.headers, now)).toMatchObject({
      webhookId: "msg_test_001", paymentId: "pay_spiceroute_0001", amountMinor: 720000, mode: "TEST",
    });
    expect(() => verifyDodoTestWebhook(config, `${request.raw} `, request.headers, now)).toThrow(/signature/);
    expect(() => verifyDodoTestWebhook(config, request.raw, { ...request.headers, "webhook-signature": "v1,invalid" }, now)).toThrow(/signature/);
    expect(() => verifyDodoTestWebhook(config, request.raw, request.headers, new Date(now.getTime() + 6 * 60_000))).toThrow(/timestamp/);
  });

  it("ignores unrelated signed events and refuses wrong amount, business, project, or status", () => {
    const unrelated = signed({ ...payment, type: "payment.failed" });
    expect(verifyDodoTestWebhook(config, unrelated.raw, unrelated.headers, now)).toBeNull();
    for (const modified of [
      { ...payment, business_id: "bus_other" },
      { ...payment, data: { ...payment.data, total_amount: 1 } },
      { ...payment, data: { ...payment.data, status: "processing" } },
      { ...payment, data: { ...payment.data, metadata: { ...payment.data.metadata, agentfront_project_id: "AF-OTHER" } } },
    ]) {
      const request = signed(modified);
      expect(() => verifyDodoTestWebhook(config, request.raw, request.headers, now)).toThrow(/does not match/);
    }
  });
});
