import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./http";

describe("provider HTTP safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses bounded JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(requestJson<{ ok: boolean }>("Example", "https://example.test/data"))
      .resolves.toEqual({ ok: true });
  });

  it("rejects provider responses with an oversized declared length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "2000001" },
    })));

    await expect(requestJson("Example", "https://example.test/data"))
      .rejects.toThrow(/safety limit/);
  });

  it("rejects oversized streamed provider responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(2_000_001), { status: 200 })));

    await expect(requestJson("Example", "https://example.test/data"))
      .rejects.toThrow(/safety limit/);
  });
});
