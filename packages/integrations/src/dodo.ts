import { createHmac, timingSafeEqual } from "node:crypto";

/** Dodo test-mode integration. No live-mode endpoint is reachable from this adapter. */
export interface DodoTestConfig {
  apiKey: string;
  productId: string;
  webhookSecret: string;
  businessId: string;
  expectedAmountMinor: number;
  currency: "INR";
  returnUrl: string;
  projectId: string;
}

export interface DodoCheckoutSession {
  sessionId: string;
  checkoutUrl: string;
  projectId: string;
  mode: "TEST";
}

export interface DodoVerifiedPayment {
  webhookId: string;
  paymentId: string;
  checkoutSessionId: string;
  projectId: string;
  productId: string;
  amountMinor: number;
  currency: "INR";
  occurredAt: string;
  mode: "TEST";
}

export class DodoTestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DodoTestError";
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const required = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new DodoTestError("INVALID_CONFIG", `${field} is required.`);
  return value.trim();
};

const testCheckoutHost = "test.checkout.dodopayments.com";

/** Fail closed unless all test-mode configuration is present and explicit. */
export function dodoTestConfigFromEnv(env: NodeJS.ProcessEnv, projectId = "AF-2026-000001"): DodoTestConfig {
  if (env.DODO_PAYMENTS_ENVIRONMENT !== "test_mode") {
    throw new DodoTestError("TEST_MODE_REQUIRED", "Dodo checkout requires explicit test_mode configuration.");
  }
  const returnUrl = required(env.DODO_TEST_RETURN_URL, "DODO_TEST_RETURN_URL");
  let parsed: URL;
  try { parsed = new URL(returnUrl); } catch { throw new DodoTestError("INVALID_CONFIG", "DODO_TEST_RETURN_URL must be a valid URL."); }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    throw new DodoTestError("INVALID_CONFIG", "DODO_TEST_RETURN_URL must use HTTPS or local HTTP.");
  }
  if (!/^AF-\d{4}-\d{6}$/.test(projectId)) {
    throw new DodoTestError("INVALID_CONFIG", "A valid AgentFront project ID is required for Dodo checkout.");
  }
  const expectedAmountMinor = Number(env.DODO_TEST_EXPECTED_AMOUNT_MINOR);
  if (!Number.isSafeInteger(expectedAmountMinor) || expectedAmountMinor < 1) {
    throw new DodoTestError("INVALID_CONFIG", "DODO_TEST_EXPECTED_AMOUNT_MINOR must be a positive integer.");
  }
  return {
    apiKey: required(env.DODO_PAYMENTS_API_KEY, "DODO_PAYMENTS_API_KEY"),
    productId: required(env.DODO_TEST_PRODUCT_ID, "DODO_TEST_PRODUCT_ID"),
    webhookSecret: required(env.DODO_PAYMENTS_WEBHOOK_KEY, "DODO_PAYMENTS_WEBHOOK_KEY"),
    businessId: required(env.DODO_TEST_BUSINESS_ID, "DODO_TEST_BUSINESS_ID"),
    expectedAmountMinor,
    currency: "INR",
    returnUrl: parsed.toString(),
    projectId,
  };
}

export async function createDodoTestCheckout(
  config: DodoTestConfig,
  customer: { email: string; name?: string },
  fetcher: typeof fetch = fetch,
): Promise<DodoCheckoutSession> {
  if (!/^AF-\d{4}-\d{6}$/.test(config.projectId)) throw new DodoTestError("INVALID_CONFIG", "A valid AgentFront project ID is required for test checkout.");
  const email = required(customer.email, "customer.email");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DodoTestError("INVALID_CUSTOMER", "A valid customer email is required.");
  }
  const name = customer.name?.trim();
  if (name && name.length > 120) throw new DodoTestError("INVALID_CUSTOMER", "Customer name is too long.");
  const body = {
    product_cart: [{ product_id: config.productId, quantity: 1 }],
    customer: { email, ...(name ? { name } : {}) },
    return_url: config.returnUrl,
    metadata: { agentfront_project_id: config.projectId, agentfront_mode: "TEST", agentfront_business: "spiceroute" },
  };
  let response: Response;
  try {
    response = await fetcher("https://test.dodopayments.com/checkouts", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new DodoTestError("PROVIDER_UNAVAILABLE", "Dodo test checkout could not be reached.");
  }
  if (!response.ok) throw new DodoTestError("PROVIDER_REJECTED", `Dodo test checkout rejected the request (${response.status}).`);
  let payload: Record<string, unknown> | null;
  try { payload = record(await response.json()); } catch { payload = null; }
  const sessionId = payload?.session_id;
  const checkoutUrl = payload?.checkout_url;
  let parsed: URL;
  try { parsed = new URL(String(checkoutUrl)); } catch { throw new DodoTestError("INVALID_PROVIDER_RESPONSE", "Dodo did not return a checkout URL."); }
  if (typeof sessionId !== "string" || !/^cks_[A-Za-z0-9_-]{8,128}$/.test(sessionId) || parsed.protocol !== "https:" || parsed.hostname !== testCheckoutHost) {
    throw new DodoTestError("INVALID_PROVIDER_RESPONSE", "Dodo did not return a valid test checkout session.");
  }
  return { sessionId, checkoutUrl: parsed.toString(), projectId: config.projectId, mode: "TEST" };
}

const signatureKey = (secret: string): Buffer => {
  if (!/^whsec_[A-Za-z0-9_+/-]+={0,2}$/.test(secret)) throw new DodoTestError("INVALID_CONFIG", "Dodo webhook secret must use whsec_ encoding.");
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 24 || key.length > 64) throw new DodoTestError("INVALID_CONFIG", "Dodo webhook secret has an invalid length.");
  return key;
};

/** Verifies Standard Webhooks v1 against the exact raw body before parsing JSON. */
export function verifyDodoTestWebhook(
  config: DodoTestConfig,
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): DodoVerifiedPayment | null {
  const bytes = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  if (bytes.length === 0 || bytes.length > 256_000) throw new DodoTestError("INVALID_WEBHOOK", "Webhook body is empty or too large.");
  const header = (key: string): string => {
    const value = headers[key] ?? headers[key.toLowerCase()];
    return typeof value === "string" ? value : "";
  };
  const webhookId = header("webhook-id");
  const timestamp = header("webhook-timestamp");
  const signatures = header("webhook-signature");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(webhookId) || !/^\d{10}$/.test(timestamp)) {
    throw new DodoTestError("INVALID_SIGNATURE", "Webhook signature headers are invalid.");
  }
  const sentAt = Number(timestamp) * 1_000;
  if (Math.abs(now.getTime() - sentAt) > 5 * 60_000) throw new DodoTestError("STALE_WEBHOOK", "Webhook timestamp is outside the allowed window.");
  const expected = createHmac("sha256", signatureKey(config.webhookSecret))
    .update(webhookId).update(".").update(timestamp).update(".").update(bytes).digest();
  const valid = signatures.split(/\s+/).some((part) => {
    if (!/^v1,[A-Za-z0-9_+/-]+={0,2}$/.test(part)) return false;
    const received = Buffer.from(part.slice(3), "base64");
    return received.length === expected.length && timingSafeEqual(expected, received);
  });
  if (!valid) throw new DodoTestError("INVALID_SIGNATURE", "Webhook signature verification failed.");

  let payload: Record<string, unknown> | null;
  try { payload = record(JSON.parse(bytes.toString("utf8")) as unknown); } catch { payload = null; }
  if (!payload) throw new DodoTestError("INVALID_WEBHOOK", "Verified webhook is not a JSON object.");
  if (payload.type !== "payment.succeeded") return null;
  const data = record(payload.data);
  const metadata = record(data?.metadata);
  const projectId = metadata?.agentfront_project_id;
  const cart = data?.product_cart;
  if (
    payload.business_id !== config.businessId ||
    (data?.business_id !== undefined && data.business_id !== config.businessId) ||
    data?.status !== "succeeded" ||
    typeof projectId !== "string" || !/^AF-\d{4}-\d{6}$/.test(projectId) ||
    metadata?.agentfront_mode !== "TEST" ||
    metadata.agentfront_business !== "spiceroute" ||
    data?.currency !== config.currency ||
    data.total_amount !== config.expectedAmountMinor ||
    !Array.isArray(cart) || cart.length !== 1 ||
    record(cart[0])?.product_id !== config.productId || record(cart[0])?.quantity !== 1 ||
    typeof data.checkout_session_id !== "string" || !/^cks_[A-Za-z0-9_-]{8,128}$/.test(data.checkout_session_id) ||
    typeof data.payment_id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(data.payment_id) ||
    typeof payload.timestamp !== "string" || !Number.isFinite(Date.parse(payload.timestamp))
  ) throw new DodoTestError("PAYMENT_MISMATCH", "Signed payment does not match the SpiceRoute test checkout.");
  return {
    webhookId,
    paymentId: data.payment_id,
    checkoutSessionId: data.checkout_session_id,
    projectId,
    productId: config.productId,
    amountMinor: config.expectedAmountMinor,
    currency: "INR",
    occurredAt: payload.timestamp,
    mode: "TEST",
  };
}
