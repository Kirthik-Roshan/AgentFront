import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationSessionInput } from "@agentfront/types";
import {
  buildElevenLabsDynamicVariables,
  ElevenLabsVoiceAgentProvider,
  type VoiceAgentRuntimeContext,
} from "./voice-agent";

const session = {
  projectId: "AF-2026-000001",
  business: {
    id: "business-1",
    name: "Spice Garden",
    category: "restaurant",
    city: "Chennai",
    website: null,
  },
  lead: { businessId: "business-1", opportunityScore: 91 },
} as ConversationSessionInput;

const context: VoiceAgentRuntimeContext = {
  identityVerified: true,
  contactName: "Raj",
  contactRole: "OWNER",
  preferredLanguage: "Tamil + English",
  previousSummary: "Receptionist requested an owner callback.",
  previousObjections: ["Needs a mobile-first menu", "Wants WhatsApp ordering"],
  dealStage: "FOLLOW_UP_REQUIRED",
  lastInteraction: "Receptionist contacted",
  nextAction: "Ask Raj about the website brief",
  websiteStatus: "MISSING",
};

describe("ElevenLabs voice agent adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds only the requested dynamic variables from a trusted, verified context", () => {
    const variables = buildElevenLabsDynamicVariables(session, context);
    expect(variables).toEqual({
      business_id: "business-1",
      business_name: "Spice Garden",
      business_category: "restaurant",
      business_city: "Chennai",
      contact_name: "Raj",
      contact_role: "OWNER",
      preferred_language: "Tamil + English",
      previous_summary: "Receptionist requested an owner callback.",
      previous_objections: "Needs a mobile-first menu; Wants WhatsApp ordering",
      deal_stage: "FOLLOW_UP_REQUIRED",
      last_interaction: "Receptionist contacted",
      next_action: "Ask Raj about the website brief",
      website_status: "MISSING",
      opportunity_score: 91,
    });
    expect(Object.keys(variables)).toHaveLength(14);
  });

  it("withholds private sales history and contact identity for an unverified caller", () => {
    const variables = buildElevenLabsDynamicVariables(session, { ...context, identityVerified: false });
    expect(variables).toMatchObject({
      business_id: "business-1",
      contact_name: "",
      contact_role: "UNKNOWN",
      previous_summary: "",
      previous_objections: "",
      deal_stage: "",
      last_interaction: "",
      next_action: "",
      opportunity_score: "",
    });
  });

  it("rejects a lead-to-business mismatch before issuing a signed grant", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsVoiceAgentProvider("server-only-key", "agent-1");
    const wrongSession = {
      ...session,
      lead: { ...session.lead, businessId: "some-other-business" },
    };
    await expect(provider.startConversation({
      session: wrongSession,
      context,
      idempotencyKey: "one",
      transport: "BROWSER_REALTIME",
    })).rejects.toThrow("identities do not match");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues a browser-only grant with runtime variables, without claiming a call has started", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=sensitive",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsVoiceAgentProvider("server-only-key", "agent-1");
    const result = await provider.startConversation({
      session,
      context,
      idempotencyKey: "one",
      transport: "BROWSER_REALTIME",
    });
    expect(result).toMatchObject({
      status: "AWAITING_BROWSER_CONNECTION",
      sessionId: "pending-AF-2026-000001",
      transport: "BROWSER_REALTIME",
      mode: "REAL",
      dynamicVariables: { business_id: "business-1", contact_name: "Raj" },
    });
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ "xi-api-key": "server-only-key" });
  });

  it("does not pretend to place or terminate a telephone call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsVoiceAgentProvider("server-only-key", "agent-1");
    await expect(provider.startConversation({
      session,
      context,
      idempotencyKey: "one",
      transport: "TELEPHONY",
    })).rejects.toThrow("no call was placed");
    await expect(provider.endConversation("provider-conversation-1")).rejects.toThrow("termination is unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
