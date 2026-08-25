import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationSessionInput } from "@agentfront/types";
import { ElevenLabsConversationProvider } from "./conversation";

const input = { projectId: "AF-2026-000001" } as ConversationSessionInput;

describe("ElevenLabs realtime conversation provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mint transport credentials during background orchestration", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsConversationProvider("server-api-key", "agent-123");

    await expect(provider.createSession(input, "background-run")).resolves.toEqual({
      id: "pending-AF-2026-000001",
      clientToken: null,
      providerUrl: null,
      mode: "REAL",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a short-lived WSS grant only from the explicit authorization operation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=sensitive",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsConversationProvider("server-api-key", "agent-123");

    const grant = await provider.authorizeClientSession(input, "browser-consent");
    expect(grant).toMatchObject({ mode: "REAL", signedUrl: expect.stringMatching(/^wss:\/\/api\.elevenlabs\.io\//) });
    expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("include_conversation_id=true");
    expect(init.headers).toMatchObject({ "xi-api-key": "server-api-key" });
  });

  it("rejects lookalike signed URL origins and conversations owned by another agent", async () => {
    const provider = new ElevenLabsConversationProvider("server-api-key", "agent-123");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      signed_url: "wss://evil-elevenlabs.io/conversation?signature=sensitive",
    }), { status: 200 })));
    await expect(provider.authorizeClientSession(input, "bad-origin")).rejects.toThrow("unexpected signed conversation URL origin");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      agent_id: "agent-other",
      status: "in-progress",
    }), { status: 200 })));
    await expect(provider.getConversation("conv-real-123")).rejects.toThrow("belongs to another agent");
  });
});
