import type {
  ConversationAccessGrant,
  ConversationOutcome,
  ConversationProvider,
  ConversationSession,
  ConversationSessionInput,
  IntegrationHealth,
  TranscriptTurn,
} from "@agentfront/types";
import { requestJson } from "./http";

const demoTranscript = (projectId: string, at: string): TranscriptTurn[] => [
  {
    id: `${projectId}-turn-1`,
    speaker: "AGENT",
    text: "Hello, I’m calling from AgentFront. May I understand how customers currently find your menu online?",
    at,
  },
  {
    id: `${projectId}-turn-2`,
    speaker: "CUSTOMER",
    text: "We mostly use Instagram. We need a proper mobile website with our menu, photos, location and WhatsApp ordering.",
    at,
  },
  {
    id: `${projectId}-turn-3`,
    speaker: "AGENT",
    text: "The approved package is ₹7,999. Within the configured policy, the final offer can be ₹100.",
    at,
  },
  {
    id: `${projectId}-turn-4`,
    speaker: "CUSTOMER",
    text: "₹100 works. Please keep the design premium, warm and easy to use on phones.",
    at,
  },
];

export class DemoConversationProvider implements ConversationProvider {
  readonly name = "AgentFront Demo Conversation";
  readonly mode = "DEMO" as const;
  readonly #sessions = new Map<string, { input: ConversationSessionInput; outcome: ConversationOutcome; ended: boolean }>();

  async createSession(input: ConversationSessionInput, _idempotencyKey: string): Promise<ConversationSession> {
    const id = `demo-conversation-${input.projectId}`;
    if (!this.#sessions.has(id)) {
      const at = new Date().toISOString();
      this.#sessions.set(id, {
        input: structuredClone(input),
        ended: false,
        outcome: {
          transcript: demoTranscript(input.projectId, at),
          summary:
            "Owner accepted a premium mobile-first restaurant website with menu, gallery, WhatsApp ordering and Google Maps for ₹100.",
          sentiment: "POSITIVE",
          requirements: {
            businessType: input.business.category,
            pages: ["Home", "Menu", "Gallery", "Contact"],
            features: {
              menu: true,
              gallery: true,
              whatsappOrdering: true,
              googleMaps: true,
              reservations: false,
            },
            branding: { style: "premium modern restaurant", primaryColour: "warm dark", mobileFirst: true },
            contentRequirements: ["Use the approved menu", "Use verified business contact details"],
            budget: { minimum: 6_000, maximum: 8_000, currency: "INR" },
            notes: ["Customer priority: mobile users"],
            approvedAt: at,
          },
          acceptedAmount: 7_200,
        },
      });
    }
    return { id, clientToken: null, providerUrl: null, mode: this.mode };
  }

  async authorizeClientSession(
    _input: ConversationSessionInput,
    _idempotencyKey: string,
  ): Promise<ConversationAccessGrant> {
    throw new Error("The demo conversation provider does not issue browser transport credentials.");
  }

  async getConversation(conversationId: string): Promise<{ status: "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" }> {
    const session = this.#sessions.get(conversationId);
    if (!session) throw new Error(`Demo conversation ${conversationId} was not found.`);
    return { status: session.ended ? "COMPLETED" : "ACTIVE" };
  }

  async getTranscript(conversationId: string): Promise<TranscriptTurn[]> {
    const session = this.#sessions.get(conversationId);
    if (!session) throw new Error(`Demo conversation ${conversationId} was not found.`);
    return structuredClone(session.outcome.transcript);
  }

  async getOutcome(conversationId: string): Promise<ConversationOutcome | null> {
    const session = this.#sessions.get(conversationId);
    if (!session) return null;
    session.ended = true;
    return structuredClone(session.outcome);
  }

  async endSession(conversationId: string): Promise<void> {
    const session = this.#sessions.get(conversationId);
    if (session) session.ended = true;
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "conversation",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: "A clearly labelled deterministic sample conversation is active.",
      checkedAt: new Date().toISOString(),
    };
  }
}

interface ElevenLabsConversationResponse {
  agent_id?: string;
  status?: string;
  metadata?: { start_time_unix_secs?: number };
  transcript?: Array<{ role?: string; message?: string; time_in_call_secs?: number }>;
  analysis?: { transcript_summary?: string; call_successful?: string };
}

export class ElevenLabsConversationProvider implements ConversationProvider {
  readonly name = "ElevenLabs Conversational AI";
  readonly mode = "REAL" as const;

  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
  ) {
    if (!apiKey.trim() || !agentId.trim()) throw new Error("ElevenLabs API key and agent ID are required.");
  }

  async createSession(input: ConversationSessionInput, _idempotencyKey: string): Promise<ConversationSession> {
    // REAL browser transport credentials are intentionally not created here. Orchestration can
    // happen in the background long before a user enters the sales room, while ElevenLabs signed
    // URLs expire quickly and act as bearer credentials. The authenticated session endpoint calls
    // authorizeClientSession just-in-time after explicit microphone consent.
    return {
      id: `pending-${input.projectId}`,
      clientToken: null,
      providerUrl: null,
      mode: this.mode,
    };
  }

  async authorizeClientSession(
    _input: ConversationSessionInput,
    _idempotencyKey: string,
  ): Promise<ConversationAccessGrant> {
    const response = await requestJson<{ signed_url: string }>(
      this.name,
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.agentId)}&include_conversation_id=true`,
      { headers: { "xi-api-key": this.apiKey } },
    );
    if (!response.signed_url) throw new Error("ElevenLabs did not return a signed conversation URL.");
    let signedUrl: URL;
    try {
      signedUrl = new URL(response.signed_url);
    } catch {
      throw new Error("ElevenLabs returned a malformed signed conversation URL.");
    }
    const isElevenLabsHost = signedUrl.hostname === "elevenlabs.io" || signedUrl.hostname.endsWith(".elevenlabs.io");
    if (signedUrl.protocol !== "wss:" || !isElevenLabsHost) {
      throw new Error("ElevenLabs returned an unexpected signed conversation URL origin.");
    }
    return {
      signedUrl: response.signed_url,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      mode: this.mode,
    };
  }

  async getConversation(conversationId: string): Promise<{ status: "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" }> {
    const response = await this.#get(conversationId);
    if (response.agent_id !== this.agentId) {
      throw new Error(`ElevenLabs conversation ${conversationId} belongs to another agent.`);
    }
    const status = response.status === "done" ? "COMPLETED" : response.status === "failed" ? "FAILED" : "ACTIVE";
    return { status };
  }

  async getTranscript(conversationId: string): Promise<TranscriptTurn[]> {
    const response = await this.#get(conversationId);
    if (response.agent_id !== this.agentId) {
      throw new Error(`ElevenLabs conversation ${conversationId} belongs to another agent.`);
    }
    const baseMilliseconds = Number.isFinite(response.metadata?.start_time_unix_secs)
      ? Number(response.metadata?.start_time_unix_secs) * 1_000
      : Date.now();
    return (response.transcript ?? [])
      .filter((turn) => typeof turn.message === "string" && turn.message.trim().length > 0)
      .map((turn, index) => ({
        id: `${conversationId}-turn-${index + 1}`,
        speaker: turn.role === "agent" ? "AGENT" : turn.role === "user" ? "CUSTOMER" : "SYSTEM",
        text: turn.message!.trim(),
        at: new Date(baseMilliseconds + Math.max(0, turn.time_in_call_secs ?? 0) * 1_000).toISOString(),
      }));
  }

  async getOutcome(_conversationId: string): Promise<ConversationOutcome | null> {
    // Commercial acceptance must be posted back after backend policy tools approve it;
    // raw LLM analysis is intentionally not trusted as an executable deal outcome.
    return null;
  }

  async endSession(_conversationId: string): Promise<void> {
    // Browser realtime sessions own their WebSocket lifecycle.
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "conversation",
      provider: this.name,
      mode: this.mode,
      status: "CONNECTED",
      message: "ElevenLabs credentials are configured; signed URLs are issued only by the API.",
      checkedAt: new Date().toISOString(),
    };
  }

  #get(conversationId: string): Promise<ElevenLabsConversationResponse> {
    return requestJson<ElevenLabsConversationResponse>(
      this.name,
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
      { headers: { "xi-api-key": this.apiKey } },
    );
  }
}
