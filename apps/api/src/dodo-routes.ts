import type { IncomingMessage, ServerResponse } from "node:http";
import type { DodoVerifiedPayment } from "@agentfront/integrations";

/** The parent router must call the checkout path only after founder authentication.
 * The webhook path is public, but verifyWebhook must validate its raw signature.
 */
export interface DodoTestRoutes {
  /** Must require SpiceRoute's accepted deal and deployed site, and persist the session against the key. */
  createCheckoutOnce: (
    idempotencyKey: string,
    customer: { email: string; name?: string },
  ) => Promise<{ sessionId: string; checkoutUrl: string; projectId: string; mode: "TEST" }>;
  verifyWebhook: (
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) => DodoVerifiedPayment | null;
  /** Must atomically check a persisted, matching session and claim webhook-id/payment-id before marking test-paid. */
  confirmPaymentOnce: (payment: NonNullable<ReturnType<DodoTestRoutes["verifyWebhook"]>>) => Promise<"recorded" | "duplicate">;
}

type RouteError = Error & { code?: string };

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function rawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += next.length;
    if (length > 256_000) throw Object.assign(new Error("Request body exceeds 256 KB."), { code: "PAYLOAD_TOO_LARGE" });
    chunks.push(next);
  }
  return Buffer.concat(chunks);
}

/** Framework-independent route mount; persistence is intentionally injected. */
export async function handleDodoTestRoute(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  routes: DodoTestRoutes,
): Promise<boolean> {
  if (pathname !== "/api/demo/spiceroute/checkout" && pathname !== "/api/webhooks/dodo-test") return false;
  if (request.method !== "POST") {
    json(response, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST is required." } });
    return true;
  }
  try {
    if (pathname === "/api/demo/spiceroute/checkout") {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
        json(response, 400, { ok: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid Idempotency-Key is required." } });
        return true;
      }
      let body: unknown;
      try { body = JSON.parse((await rawBody(request)).toString("utf8")); } catch (error) {
        if ((error as RouteError).code === "PAYLOAD_TOO_LARGE") throw error;
        json(response, 400, { ok: false, error: { code: "INVALID_JSON", message: "A JSON body is required." } });
        return true;
      }
      const fields = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      const email = fields?.email;
      const name = fields?.name;
      if (!fields || Object.keys(fields).some((field) => !["email", "name"].includes(field)) ||
          typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 120))) {
        json(response, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "A valid email and optional name are required." } });
        return true;
      }
      const result = await routes.createCheckoutOnce(key, { email, ...(name ? { name } : {}) });
      json(response, 200, { ok: true, data: result });
      return true;
    }
    const payment = routes.verifyWebhook(await rawBody(request), request.headers);
    if (!payment) {
      json(response, 200, { ok: true, data: { received: true, applicable: false } });
      return true;
    }
    const outcome = await routes.confirmPaymentOnce(payment);
    json(response, 200, { ok: true, data: { received: true, applicable: true, recorded: outcome === "recorded", mode: "TEST" } });
    return true;
  } catch (error) {
    const code = (error as RouteError).code;
    if (code === "INVALID_SIGNATURE" || code === "STALE_WEBHOOK") {
      json(response, 401, { ok: false, error: { code: "WEBHOOK_UNAUTHORIZED", message: "Webhook verification failed." } });
    } else if (code === "PAYLOAD_TOO_LARGE") {
      json(response, 413, { ok: false, error: { code, message: "Request body exceeds 256 KB." } });
    } else if (code === "INVALID_WEBHOOK" || code === "PAYMENT_MISMATCH") {
      json(response, 400, { ok: false, error: { code, message: "Webhook payload is invalid or does not match this demo." } });
    } else if (code === "TEST_MODE_REQUIRED" || code === "INVALID_CONFIG" || code === "PAYMENTS_UNAVAILABLE") {
      json(response, 503, { ok: false, error: { code: "PAYMENTS_UNAVAILABLE", message: "Dodo test checkout is not configured." } });
    } else if (pathname === "/api/demo/spiceroute/checkout" &&
        ["CHECKOUT_CONFLICT", "CHECKOUT_IN_PROGRESS", "CHECKOUT_RESERVATION_EXPIRED", "DEMO_DEAL_NOT_READY"].includes(code ?? "")) {
      json(response, 409, { ok: false, error: { code, message: (error as Error).message } });
    } else if (pathname === "/api/demo/spiceroute/checkout" &&
        ["PROVIDER_UNAVAILABLE", "PROVIDER_REJECTED", "INVALID_PROVIDER_RESPONSE"].includes(code ?? "")) {
      json(response, 502, { ok: false, error: { code: "CHECKOUT_PROVIDER_UNAVAILABLE", message: "Dodo test checkout could not be created." } });
    } else {
      // 5xx makes Dodo retry; never acknowledge a payment before durable recording succeeds.
      json(response, 503, { ok: false, error: { code: "PAYMENT_RECORDING_UNAVAILABLE", message: "Payment could not be recorded; retry is required." } });
    }
    return true;
  }
}
