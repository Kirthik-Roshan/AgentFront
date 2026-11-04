import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizePhoneToE164, SalesStateMachine } from "@agentfront/orchestration";
import type { SalesBusinessDetail, SalesCall, SalesEvent, SalesState, SalesStateTransitionRecord } from "@agentfront/types";
import type { ApiRuntime } from "./runtime";

const MAX_BODY_BYTES = 256_000;
const stateMachine = new SalesStateMachine();

type SarvamStatus = "connected" | "no_answer" | "busy" | "failed";
type SarvamTranscriptTurn = { role: "agent" | "user"; en_text: string };

interface SarvamCompletion {
  attemptId: string;
  status: SarvamStatus;
  duration: number | null;
  interactionId: string | null;
  failureReason: string | null;
  variables: Record<string, string>;
  transcript: SarvamTranscriptTurn[];
  businessId: string;
  salesCallId: string;
}

class SarvamRouteError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

const send = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SarvamRouteError(400, "INVALID_WEBHOOK", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const string = (value: unknown, label: string, maximum = 4_000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new SarvamRouteError(400, "INVALID_WEBHOOK", `${label} is missing or invalid.`);
  }
  return value.trim();
};

const optionalString = (value: unknown, maximum = 4_000): string | null =>
  value == null ? null : string(value, "optional webhook string", maximum);

export function parseSarvamOutboundCompletion(value: unknown): SarvamCompletion {
  const payload = object(value, "webhook");
  const status = string(payload.status, "status", 32) as SarvamStatus;
  if (!["connected", "no_answer", "busy", "failed"].includes(status)) {
    throw new SarvamRouteError(400, "INVALID_WEBHOOK", "Unsupported Sarvam status.");
  }
  const webhookConfig = object(payload.webhook_config, "webhook_config");
  const metadata = object(webhookConfig.metadata, "webhook_config.metadata");
  // Instant Outbound documents extracted values in final_agent_variables.
  // Some Sarvam webhook variants also expose post-interaction extraction in
  // output_agent_variables, so retain that compatibility shape and let the
  // explicitly extracted output override an earlier in-call value.
  const finalVariables = payload.final_agent_variables == null
    ? {}
    : object(payload.final_agent_variables, "final_agent_variables");
  const outputVariables = payload.output_agent_variables == null
    ? {}
    : object(payload.output_agent_variables, "output_agent_variables");
  const rawVariables = { ...finalVariables, ...outputVariables };
  const variables: Record<string, string> = {};
  for (const [key, item] of Object.entries(rawVariables)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof item !== "string" || item.length > 10_000) {
      throw new SarvamRouteError(400, "INVALID_WEBHOOK", "Sarvam agent variables contain an invalid entry.");
    }
    variables[key] = item.trim();
  }
  const rawTranscript = payload.interaction_transcript ?? [];
  if (!Array.isArray(rawTranscript) || rawTranscript.length > 1_000) {
    throw new SarvamRouteError(400, "INVALID_WEBHOOK", "Sarvam transcript is invalid.");
  }
  const transcript = rawTranscript.map((item, index) => {
    const turn = object(item, `interaction_transcript[${index}]`);
    const role = string(turn.role, `interaction_transcript[${index}].role`, 16);
    if (role !== "agent" && role !== "user") throw new SarvamRouteError(400, "INVALID_WEBHOOK", "Transcript role is invalid.");
    return { role: role as SarvamTranscriptTurn["role"],
      en_text: string(turn.en_text, `interaction_transcript[${index}].en_text`, 20_000) };
  });
  const duration = payload.duration == null ? null : Number(payload.duration);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 86_400)) {
    throw new SarvamRouteError(400, "INVALID_WEBHOOK", "Sarvam duration is invalid.");
  }
  return {
    attemptId: string(payload.attempt_id, "attempt_id", 256), status,
    duration, interactionId: optionalString(payload.interaction_id, 256),
    failureReason: optionalString(payload.failure_reason, 1_000), variables, transcript,
    businessId: string(metadata.business_id, "metadata.business_id", 128),
    salesCallId: string(metadata.salesCallId, "metadata.salesCallId", 128),
  };
}

function safeTokenMatch(received: string | null, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function transcriptText(turns: SarvamTranscriptTurn[]): string | null {
  if (!turns.length) return null;
  return turns.map((turn) => `${turn.role === "agent" ? "AGENT" : "CUSTOMER"}: ${turn.en_text}`).join("\n").slice(0, 20_000);
}

/** The private dial target is never used as website content. */
const customerTranscript = (turns: readonly SarvamTranscriptTurn[]): string =>
  turns.filter((turn) => turn.role === "user").map((turn) => turn.en_text).join("\n");

export function resolveSarvamCustomerEmail(
  variables: Readonly<Record<string, string>>,
  transcript: readonly SarvamTranscriptTurn[] = [],
): string | null {
  const extracted = variables.client_email?.trim().toLowerCase();
  const candidates = extracted ? [extracted] : customerTranscript(transcript).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const unique = [...new Set(candidates.map((candidate) => candidate.toLowerCase()))];
  return unique.length === 1 && unique[0]!.length <= 254 ? unique[0]! : null;
}

export function resolveSarvamPublicBusinessPhone(
  variables: Readonly<Record<string, string>>,
  environment: { DEMO_PUBLIC_BUSINESS_PHONE?: string },
  transcript: readonly SarvamTranscriptTurn[] = [],
): string | null {
  const allowed = environment.DEMO_PUBLIC_BUSINESS_PHONE?.trim();
  if (!allowed) return null;
  const candidates = variables.public_business_phone?.trim()
    ? [variables.public_business_phone.trim()]
    : customerTranscript(transcript).match(/(?:\+?\d[\s().-]*){10,15}/g) ?? [];
  try {
    const normalizedAllowed = normalizePhoneToE164(allowed);
    const matches = candidates.flatMap((candidate) => {
      try { return [normalizePhoneToE164(candidate)]; } catch { return []; }
    }).filter((candidate) => candidate === normalizedAllowed);
    return matches.length > 0 ? normalizedAllowed : null;
  } catch {
    return null;
  }
}

function transitionPath(detail: SalesBusinessDetail, path: SalesState[], key: string): {
  transitions: SalesStateTransitionRecord[]; events: SalesEvent[];
} {
  const transitions: SalesStateTransitionRecord[] = [];
  const events: SalesEvent[] = [];
  let state = detail.business.salesState;
  const timestamp = new Date().toISOString();
  for (const [index, target] of path.entries()) {
    const transition = stateMachine.transition({
      businessId: detail.business.id, currentState: state, targetState: target,
      actor: "VOICE_AGENT", reason: "Sarvam outbound call completed.",
      idempotencyKey: `${key}:transition:${index + 1}`, at: timestamp,
    }, [...detail.transitions, ...transitions]).transition;
    transitions.push(transition);
    events.push({ id: randomUUID(), businessId: detail.business.id, eventType: "SALES_STATE_CHANGED",
      metadata: { from: state, to: target, provider: "sarvam" }, correlationId: detail.business.id,
      idempotencyKey: `${key}:state:${index + 1}`, timestamp });
    state = target;
  }
  return { transitions, events };
}

async function saveNonWinningResult(runtime: ApiRuntime, detail: SalesBusinessDetail, call: SalesCall, result: SarvamCompletion): Promise<void> {
  const now = new Date().toISOString();
  const connected = result.status === "connected";
  const doNotCall = result.variables.do_not_call?.toUpperCase() === "YES";
  const dealStatus = result.variables.deal_status?.toUpperCase();
  const summary = (result.variables.requirements_summary || result.failureReason ||
    `Sarvam call finished with status ${result.status}.`).slice(0, 4_000);
  const completedCall: SalesCall = {
    ...call,
    status: connected ? "COMPLETED" : result.status === "no_answer" ? "NO_ANSWER" : result.status === "busy" ? "BUSY" : "FAILED",
    outcome: doNotCall ? "DO_NOT_CONTACT" : dealStatus === "LOST" ? "DEAL_LOST" :
      dealStatus === "CALLBACK" ? "CALLBACK_REQUESTED" : connected ? "FOLLOW_UP_REQUIRED" :
        result.status === "no_answer" || result.status === "busy" ? "NO_ANSWER" : "FAILED",
    summary, transcript: transcriptText(result.transcript), endedAt: now, updatedAt: now,
    metadata: { ...call.metadata, sarvamInteractionId: result.interactionId, durationSeconds: result.duration,
      finalAgentVariables: result.variables },
  };
  await runtime.salesRepository.applyChange({ businessId: detail.business.id, calls: [completedCall],
    events: [{ id: randomUUID(), businessId: detail.business.id,
      eventType: connected ? "CALL_COMPLETED" : "CALL_FAILED",
      metadata: { callId: call.id, attemptId: result.attemptId, status: result.status },
      correlationId: detail.business.id, idempotencyKey: `sarvam:${result.attemptId}:call`, timestamp: now }],
  });
  if (doNotCall) {
    await runtime.salesOrchestrator.markDoNotContact(detail.business.id, "Opt-out captured by Sarvam.", `sarvam:${result.attemptId}:dnc`, "VOICE_AGENT");
    return;
  }
  const fresh = await runtime.salesRepository.getDetail(detail.business.id);
  if (!fresh || fresh.business.salesState !== "CALLING") return;
  const path: SalesState[] = connected
    ? dealStatus === "LOST" ? ["CONTACTED", "DEAL_LOST"]
      : dealStatus === "CALLBACK" ? ["CONTACTED", "CALLBACK_REQUESTED"]
        : ["FOLLOW_UP_REQUIRED"]
    : ["FOLLOW_UP_REQUIRED"];
  const state = transitionPath(fresh, path, `sarvam:${result.attemptId}`);
  await runtime.salesRepository.applyChange({ businessId: fresh.business.id,
    expectedState: fresh.business.salesState, nextState: path.at(-1), ...state });
}

async function saveWonResult(runtime: ApiRuntime, detail: SalesBusinessDetail, call: SalesCall, result: SarvamCompletion, environment: NodeJS.ProcessEnv): Promise<boolean> {
  const variables = result.variables;
  const priceMatch = variables.agreed_price?.match(/\d[\d,]*/g);
  const agreedPrice = priceMatch?.length === 1 ? Number(priceMatch[0]!.replaceAll(",", "")) : Number.NaN;
  const configuredPrice = Number(environment.SPICEROUTE_DEMO_PRICE_INR ?? 7_200);
  if (!Number.isSafeInteger(configuredPrice) || configuredPrice < 1) {
    throw new SarvamRouteError(503, "SARVAM_NOT_CONFIGURED", "SPICEROUTE_DEMO_PRICE_INR must be a positive integer.");
  }
  const customerEmail = resolveSarvamCustomerEmail(variables, result.transcript);
  const publicBusinessPhone = resolveSarvamPublicBusinessPhone(variables, {
    DEMO_PUBLIC_BUSINESS_PHONE: detail.business.source === "GOOGLE_PLACES"
      ? detail.business.phone ?? undefined
      : environment.DEMO_PUBLIC_BUSINESS_PHONE,
  }, result.transcript);
  if (variables.deal_status?.toUpperCase() !== "WON" || variables.do_not_call?.toUpperCase() === "YES" ||
      agreedPrice !== configuredPrice || !variables.owner_name || !variables.requirements_summary || !publicBusinessPhone ||
      !customerEmail || customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return false;
  const phone = detail.business.source === "GOOGLE_PLACES"
    ? detail.business.phone?.trim()
    : environment.DEMO_BUSINESS_PHONE?.trim();
  if (!phone) throw new SarvamRouteError(503, "SARVAM_NOT_CONFIGURED", "The called business phone is unavailable.");
  const contact = detail.contacts.find((item) => item.normalizedPhone.replace(/\D/g, "") === phone.replace(/\D/g, "")) ??
    await runtime.salesOrchestrator.createContact({ businessId: detail.business.id,
      name: variables.owner_name, phone, roles: ["OWNER"], isDecisionMaker: true,
      preferredLanguage: variables.preferred_language?.toUpperCase().includes("TAMIL") ? "TAMIL" :
        variables.preferred_language?.toUpperCase().includes("HINDI") ? "HINDI" : "ENGLISH",
      source: "FOUNDER", verified: true, idempotencyKey: `sarvam:${result.attemptId}:owner` });
  const fresh = await runtime.salesRepository.getDetail(detail.business.id);
  if (!fresh) throw new SarvamRouteError(404, "BUSINESS_NOT_FOUND", "Sales business disappeared.");
  const boundCall = fresh.calls.find((item) => item.id === call.id);
  if (!boundCall) throw new SarvamRouteError(409, "CALL_CORRELATION_FAILED", "Sales call disappeared.");
  if (fresh.business.salesState === "CALLING") {
    const state = transitionPath(fresh, ["CONTACTED", "OWNER_CONTACTED"], `sarvam:${result.attemptId}:owner-connected`);
    await runtime.salesRepository.applyChange({ businessId: fresh.business.id, expectedState: "CALLING",
      nextState: "OWNER_CONTACTED", ...state,
      calls: [{ ...boundCall, contactId: contact.id, status: "IN_PROGRESS",
        transcript: transcriptText(result.transcript),
        metadata: { ...boundCall.metadata, sarvamInteractionId: result.interactionId,
          durationSeconds: result.duration, finalAgentVariables: result.variables },
        updatedAt: new Date().toISOString() }] });
  }
  const campaign = await runtime.store.getCampaign("campaign-stage-1-demo");
  if (!campaign) throw new SarvamRouteError(503, "CAMPAIGN_NOT_FOUND", "The sales campaign is unavailable.");
  await runtime.salesOrchestrator.recordDealWon({ businessId: detail.business.id, callId: call.id,
    decisionMakerContactId: contact.id, summary: variables.requirements_summary, objections: [],
    publicBusinessPhone, customerEmail,
    requirements: { pages: ["Home", "Menu", "Gallery", "Contact"],
      features: { menu: true, gallery: true, whatsappOrdering: true, googleMaps: true },
      notes: [variables.requirements_summary, variables.services_prices].filter(Boolean) },
    branding: { style: variables.website_style || "premium traditional", primaryColour: variables.primary_color || null, mobileFirst: true },
    quotedPrice: configuredPrice, agreedPrice: configuredPrice,
    campaign: { ...campaign, pricingPolicy: { ...campaign.pricingPolicy,
      basePrice: configuredPrice, minimumPrice: configuredPrice, maximumPrice: configuredPrice,
      maximumDiscountPercent: 0 } },
    language: contact.preferredLanguage, transcript: transcriptText(result.transcript),
    idempotencyKey: `sarvam:${result.attemptId}:won` });
  return true;
}

export async function handleSarvamOutboundWebhook(
  runtime: ApiRuntime, request: IncomingMessage, response: ServerResponse,
  pathname: string, searchParams: URLSearchParams, environment: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (pathname !== "/api/webhooks/sarvam/outbound") return false;
  try {
    if (request.method !== "POST") throw new SarvamRouteError(405, "METHOD_NOT_ALLOWED", "Sarvam webhook accepts POST only.");
    const secret = environment.SARVAM_WEBHOOK_TOKEN?.trim();
    if (!secret || secret.length < 24 || !safeTokenMatch(searchParams.get("token"), secret)) {
      throw new SarvamRouteError(401, "UNAUTHORIZED", "Sarvam webhook authentication failed.");
    }
    let raw = "";
    for await (const chunk of request) {
      raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new SarvamRouteError(413, "PAYLOAD_TOO_LARGE", "Sarvam webhook is too large.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new SarvamRouteError(400, "INVALID_JSON", "Sarvam webhook must be JSON."); }
    const result = parseSarvamOutboundCompletion(parsed);
    const detail = await runtime.salesRepository.getDetail(result.businessId);
    if (!detail) throw new SarvamRouteError(404, "BUSINESS_NOT_FOUND", "Webhook business was not found.");
    const call = detail.calls.find((item) => item.id === result.salesCallId && item.providerCallId === result.attemptId && item.providerMode === "REAL");
    if (!call) throw new SarvamRouteError(409, "CALL_CORRELATION_FAILED", "Sarvam attempt does not match the persisted call.");
    if (call.endedAt) { send(response, 200, { ok: true, replayed: true }); return true; }
    const won = result.status === "connected" && await saveWonResult(runtime, detail, call, result, environment);
    if (!won) await saveNonWinningResult(runtime, detail, call, result);
    send(response, 200, { ok: true, replayed: false, outcome: won ? "DEAL_WON" : result.status });
  } catch (error) {
    const routeError = error instanceof SarvamRouteError ? error : new SarvamRouteError(500, "SARVAM_WEBHOOK_FAILED", "Sarvam webhook processing failed.");
    send(response, routeError.statusCode, { ok: false, error: { code: routeError.code, message: routeError.message } });
  }
  return true;
}
