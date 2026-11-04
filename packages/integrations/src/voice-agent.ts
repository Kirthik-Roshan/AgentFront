import type {
  ConversationSessionInput,
  IntegrationHealth,
  ProviderMode,
  TranscriptTurn,
} from "@agentfront/types";
import { ElevenLabsConversationProvider } from "./conversation";

/** Trusted, database-derived context. Never populate this from voice-agent tool arguments. */
export interface VoiceAgentRuntimeContext {
  /** Caller identity must be established before private sales history is supplied. */
  identityVerified: boolean;
  contactName?: string | null;
  contactRole?: string | null;
  preferredLanguage?: string | null;
  previousSummary?: string | null;
  previousObjections?: readonly string[];
  dealStage?: string | null;
  lastInteraction?: string | null;
  nextAction?: string | null;
  websiteStatus?: string | null;
}

export interface ElevenLabsDynamicVariables {
  business_id: string;
  business_name: string;
  business_category: string;
  business_city: string;
  contact_name: string;
  contact_role: string;
  preferred_language: string;
  previous_summary: string;
  previous_objections: string;
  deal_stage: string;
  last_interaction: string;
  next_action: string;
  website_status: string;
  opportunity_score: number | "";
}

export interface VoiceAgentStartInput {
  session: ConversationSessionInput;
  context: VoiceAgentRuntimeContext;
  idempotencyKey: string;
  /** A phone call requires a separate, configured telephony-to-ElevenLabs bridge. */
  transport: "BROWSER_REALTIME" | "TELEPHONY";
}

export interface VoiceAgentStartResult {
  /** Pending until the browser actually establishes and binds its WebSocket session. */
  status: "AWAITING_BROWSER_CONNECTION";
  sessionId: string;
  mode: ProviderMode;
  transport: "BROWSER_REALTIME";
  /** Short-lived bearer credential. Return only through an authenticated, no-store API response. */
  signedUrl: string;
  expiresAt: string;
  /** Supply as `dynamicVariables` in the ElevenLabs client startSession call. */
  dynamicVariables: ElevenLabsDynamicVariables;
}

export interface VoiceAgentProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  startConversation(input: VoiceAgentStartInput): Promise<VoiceAgentStartResult>;
  getConversation(conversationId: string): Promise<{ status: "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" }>;
  endConversation(conversationId: string): Promise<void>;
  getTranscript(conversationId: string): Promise<TranscriptTurn[]>;
  health(): Promise<IntegrationHealth>;
}

const boundedText = (value: string | null | undefined, maximum = 1_000): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";

/** Only allowlisted scalar variables are passed to ElevenLabs; no secrets or raw model state. */
export function buildElevenLabsDynamicVariables(
  session: ConversationSessionInput,
  context: VoiceAgentRuntimeContext,
): ElevenLabsDynamicVariables {
  const businessId = boundedText(session.business?.id, 128);
  const businessName = boundedText(session.business?.name, 200);
  const businessCategory = boundedText(session.business?.category, 80);
  const businessCity = boundedText(session.business?.city, 120);
  if (!businessId || !businessName || !businessCategory || !businessCity) {
    throw new Error("Voice conversation requires a complete, trusted business profile.");
  }
  if (session.lead?.businessId !== businessId) {
    throw new Error("Voice conversation lead and business identities do not match.");
  }

  const verified = context.identityVerified === true;
  const objections = verified && Array.isArray(context.previousObjections)
    ? context.previousObjections.slice(0, 20).map((item) => boundedText(item, 300)).filter(Boolean).join("; ")
    : "";
  const score = Number.isFinite(session.lead.opportunityScore) && session.lead.opportunityScore >= 0
    && session.lead.opportunityScore <= 100
    ? session.lead.opportunityScore
    : "";

  return {
    business_id: businessId,
    business_name: businessName,
    business_category: businessCategory,
    business_city: businessCity,
    contact_name: verified ? boundedText(context.contactName, 120) : "",
    contact_role: verified ? boundedText(context.contactRole, 80) : "UNKNOWN",
    preferred_language: boundedText(context.preferredLanguage, 80) || "English",
    previous_summary: verified ? boundedText(context.previousSummary, 2_000) : "",
    previous_objections: objections,
    deal_stage: verified ? boundedText(context.dealStage, 80) : "",
    last_interaction: verified ? boundedText(context.lastInteraction, 1_000) : "",
    next_action: verified ? boundedText(context.nextAction, 1_000) : "",
    website_status: boundedText(context.websiteStatus, 80) || (session.business.website ? "PRESENT" : "MISSING"),
    opportunity_score: verified ? score : "",
  };
}

/** Browser realtime adapter. It does not place, bridge, or terminate telephone calls. */
export class ElevenLabsVoiceAgentProvider implements VoiceAgentProvider {
  readonly name = "ElevenLabs Voice Agent";
  readonly mode = "REAL" as const;
  readonly #conversation: ElevenLabsConversationProvider;

  constructor(apiKey: string, agentId: string) {
    this.#conversation = new ElevenLabsConversationProvider(apiKey, agentId);
  }

  async startConversation(input: VoiceAgentStartInput): Promise<VoiceAgentStartResult> {
    if (input.transport !== "BROWSER_REALTIME") {
      throw new Error("ElevenLabs telephone calls require a configured telephony bridge; no call was placed.");
    }
    const dynamicVariables = buildElevenLabsDynamicVariables(input.session, input.context);
    const session = await this.#conversation.createSession(input.session, input.idempotencyKey);
    const grant = await this.#conversation.authorizeClientSession(input.session, input.idempotencyKey);
    return {
      status: "AWAITING_BROWSER_CONNECTION",
      sessionId: session.id,
      mode: grant.mode,
      transport: "BROWSER_REALTIME",
      signedUrl: grant.signedUrl,
      expiresAt: grant.expiresAt,
      dynamicVariables,
    };
  }

  getConversation(conversationId: string) {
    return this.#conversation.getConversation(conversationId);
  }

  async endConversation(_conversationId: string): Promise<void> {
    // The browser owns its realtime WebSocket. Returning success here would falsely imply
    // that the server terminated a remote call, so callers must close their local session.
    throw new Error("Server-side termination is unavailable for browser realtime conversations.");
  }

  getTranscript(conversationId: string) {
    return this.#conversation.getTranscript(conversationId);
  }

  async health(): Promise<IntegrationHealth> {
    const health = await this.#conversation.health();
    return {
      ...health,
      provider: this.name,
      message: "Browser realtime grants are available; telephone bridging and server-side termination are not configured.",
    };
  }
}
