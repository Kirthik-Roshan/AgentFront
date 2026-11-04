import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createRouter } from "./router";
import { createRuntime } from "./runtime";

async function request(
  router: ReturnType<typeof createRouter>, path: string,
  method: string, body?: unknown, token?: string, key?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const incoming = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage;
  Object.assign(incoming, { method, url: path, headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(key ? { "idempotency-key": key } : {}),
  } });
  let status = 0;
  let output = "";
  const response = { setHeader() { return this; }, writeHead(code: number) { status = code; return this; },
    end(chunk?: unknown) { output += String(chunk ?? ""); return this; },
    write(chunk: unknown) { output += String(chunk); return true; } } as unknown as ServerResponse;
  await router(incoming, response);
  return { status, body: output ? JSON.parse(output) as Record<string, unknown> : {} };
}

describe("private voice agent tools", () => {
  it("requires the tool secret and a matching provider call before persisting sales memory", async () => {
    const environment = { DEMO_MODE: "true", TELEPHONY_PROVIDER: "demo", ELEVENLABS_TOOL_SECRET: "voice-tool-secret",
      AGENTFRONT_API_TOKEN: "founder-secret", WEB_ORIGIN: "http://localhost:3000" };
    const runtime = createRuntime(environment);
    const router = createRouter(runtime, { environment, bindHost: "127.0.0.1" });
    const base = "/api/sales/businesses/business-spiceroute";
    expect((await request(router, `${base}/queue`, "POST", {}, "founder-secret", "voice-queue")).status).toBe(202);
    const started = await request(router, `${base}/call`, "POST", { allowDemoOutsideWindow: true }, "founder-secret", "voice-call");
    expect(started.status).toBe(201);
    const call = (started.body.data as { call: { id: string; providerCallId: string } }).call;
    const toolBody = { businessId: "business-spiceroute", callId: call.id,
      providerCallId: call.providerCallId, idempotencyKey: "voice-objection-1", input: { objection: "Needs a bilingual menu" } };
    expect((await request(router, "/api/voice/tools/add_objection", "POST", toolBody)).status).toBe(401);
    expect((await request(router, "/api/voice/tools/add_objection", "POST", toolBody, "founder-secret")).status).toBe(401);
    const mismatch = await request(router, "/api/voice/tools/add_objection", "POST", { ...toolBody, providerCallId: "forged-call" }, "voice-tool-secret");
    expect(mismatch.body).toMatchObject({ error: { code: "CALL_CORRELATION_FAILED" } });
    const saved = await request(router, "/api/voice/tools/add_objection", "POST", toolBody, "voice-tool-secret");
    expect(saved.status).toBe(200);
    const detail = await request(router, base, "GET", undefined, "founder-secret");
    expect(detail.body).toMatchObject({ data: { memory: { objections: ["Needs a bilingual menu"] } } });
    const replay = await request(router, "/api/voice/tools/add_objection", "POST", toolBody, "voice-tool-secret");
    expect(replay.body).toMatchObject({ data: { replayed: true } });
    const detailAfterReplay = await request(router, base, "GET", undefined, "founder-secret");
    expect(detailAfterReplay.body).toMatchObject({ data: { memory: { objections: ["Needs a bilingual menu"] } } });
    const created = await request(router, "/api/voice/tools/create_contact", "POST", {
      ...toolBody, idempotencyKey: "voice-contact-1",
      input: { name: "Claimed owner", phone: "+91 98400 99888", roles: ["OWNER"], isDecisionMaker: true },
    }, "voice-tool-secret");
    expect(created.status).toBe(200);
    const contactId = (created.body.data as { result: { id: string } }).result.id;
    const unsafeElevation = await request(router, "/api/voice/tools/mark_decision_maker", "POST", {
      ...toolBody, idempotencyKey: "voice-elevate-1", input: { contactId },
    }, "voice-tool-secret");
    expect(unsafeElevation.body).toMatchObject({ error: { code: "IDENTITY_NOT_VERIFIED" } });
    await runtime.close();
  });
});
