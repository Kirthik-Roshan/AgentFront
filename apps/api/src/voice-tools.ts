import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SalesStateMachine } from "@agentfront/orchestration";
import type {
  Contact, ContactRole, CRMOutboxItem, CRMOutboxOperation, SalesBusinessDetail,
  SalesEvent, SalesEventType, SalesMemory, SalesState, SupportedSalesLanguage,
} from "@agentfront/types";
import type { ApiRuntime } from "./runtime";

/** These endpoints are private ElevenLabs server tools, not browser APIs. */
const names = new Set([
  "identify_contact", "create_contact", "update_contact", "set_contact_role", "mark_decision_maker",
  "save_call_context", "save_sales_summary", "add_objection", "save_requirement", "schedule_callback",
  "create_quote", "update_deal_stage", "mark_deal_won", "mark_deal_lost", "mark_do_not_contact",
  "generate_project_spec", "sync_freshworks",
]);
const roles = new Set<ContactRole>(["OWNER", "CO_OWNER", "MANAGER", "DECISION_MAKER", "RECEPTIONIST", "EMPLOYEE", "UNKNOWN"]);
const languages = new Set<SupportedSalesLanguage>(["ENGLISH", "HINDI", "TAMIL", "KANNADA", "TELUGU", "MALAYALAM"]);
const mutableStages = new Set<SalesState>([
  "CONTACTED", "RECEPTIONIST_CONTACTED", "DECISION_MAKER_REQUIRED", "OWNER_CONTACT_IDENTIFIED",
  "CALLBACK_REQUESTED", "FOLLOW_UP_SCHEDULED", "OWNER_CONTACTED", "DISCOVERY_CONVERSATION",
  "REQUIREMENTS_COLLECTING", "NEGOTIATING", "QUOTE_PRESENTED", "FOLLOW_UP_REQUIRED",
]);
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const stateMachine = new SalesStateMachine();

class VoiceToolError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function send(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify({ ok: true, data }));
}
function fail(response: ServerResponse, status: number, code: string, message: string): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify({ ok: false, error: { code, message } }));
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VoiceToolError(400, "VALIDATION_ERROR", `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, limit = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new VoiceToolError(400, "VALIDATION_ERROR", `${label} must be 1–${limit} characters.`);
  return value.trim();
}
function optionalString(value: unknown, label: string, limit = 2_000): string | null {
  return value == null ? null : string(value, label, limit);
}
function id(value: unknown, label: string): string {
  const result = string(value, label, 128);
  if (!identifier.test(result)) throw new VoiceToolError(400, "VALIDATION_ERROR", `${label} has unsupported characters.`);
  return result;
}
function listedRoles(value: unknown): ContactRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4 || value.some((item) => !roles.has(item as ContactRole))) {
    throw new VoiceToolError(400, "VALIDATION_ERROR", "roles must contain 1–4 valid roles.");
  }
  return [...new Set(value as ContactRole[])];
}
function language(value: unknown): SupportedSalesLanguage | null {
  if (value == null) return null;
  if (!languages.has(value as SupportedSalesLanguage)) throw new VoiceToolError(400, "VALIDATION_ERROR", "Unsupported language.");
  return value as SupportedSalesLanguage;
}
function number(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new VoiceToolError(400, "VALIDATION_ERROR", `${label} must be a non-negative integer.`);
  return value as number;
}
function event(detail: SalesBusinessDetail, type: SalesEventType, key: string, metadata: Record<string, unknown>): SalesEvent {
  return { id: randomUUID(), businessId: detail.business.id, eventType: type, metadata,
    correlationId: detail.business.id, idempotencyKey: key, timestamp: new Date().toISOString() };
}
function memory(detail: SalesBusinessDetail, patch: Partial<SalesMemory>): SalesMemory {
  const now = new Date().toISOString();
  return { id: detail.memory?.id ?? randomUUID(), businessId: detail.business.id,
    summary: detail.memory?.summary ?? "", objections: detail.memory?.objections ?? [],
    requirements: detail.memory?.requirements ?? {}, quotedPrice: detail.memory?.quotedPrice ?? null,
    agreedPrice: detail.memory?.agreedPrice ?? null, currency: detail.memory?.currency ?? "INR",
    dealStage: detail.memory?.dealStage ?? detail.business.salesState,
    nextAction: detail.memory?.nextAction ?? null, nextActionAt: detail.memory?.nextActionAt ?? null,
    lastContactId: detail.memory?.lastContactId ?? null,
    createdAt: detail.memory?.createdAt ?? now, updatedAt: now, ...patch };
}
function outbox(detail: SalesBusinessDetail, operation: CRMOutboxOperation, key: string, payload: Record<string, unknown>): CRMOutboxItem {
  const now = new Date().toISOString();
  return { id: randomUUID(), businessId: detail.business.id, operation, payload,
    status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 8,
    lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
    idempotencyKey: key, createdAt: now, updatedAt: now };
}
function contactFor(detail: SalesBusinessDetail, value: unknown): Contact {
  const contactId = id(value, "contactId");
  const contact = detail.contacts.find((item) => item.id === contactId);
  if (!contact) throw new VoiceToolError(404, "CONTACT_NOT_FOUND", "Contact does not belong to this business.");
  return contact;
}
function requirements(value: unknown): { pages: string[]; features: Record<string, boolean>; notes: string[] } {
  const input = object(value, "requirements");
  if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 20 || input.pages.some((page) => typeof page !== "string" || !page.trim())) {
    throw new VoiceToolError(400, "VALIDATION_ERROR", "requirements.pages must contain 1–20 page names.");
  }
  const features = object(input.features, "requirements.features");
  if (Object.values(features).some((value) => typeof value !== "boolean")) throw new VoiceToolError(400, "VALIDATION_ERROR", "Feature flags must be boolean.");
  const notes = input.notes ?? [];
  if (!Array.isArray(notes) || notes.length > 50 || notes.some((note) => typeof note !== "string")) throw new VoiceToolError(400, "VALIDATION_ERROR", "requirements.notes must be an array of strings.");
  return { pages: input.pages as string[], features: features as Record<string, boolean>, notes: notes as string[] };
}

async function execute(runtime: ApiRuntime, name: string, detail: SalesBusinessDetail, callId: string, input: Record<string, unknown>, key: string): Promise<unknown> {
  const businessId = detail.business.id;
  const boundCall = detail.calls.find((item) => item.id === callId)!;
  const repository = runtime.salesRepository;
  const apply = async (eventType: SalesEventType, patch: Parameters<typeof repository.applyChange>[0], metadata: Record<string, unknown> = {}): Promise<SalesBusinessDetail> =>
    repository.applyChange({ ...patch, businessId, events: [...(patch.events ?? []), event(detail, eventType, key, { tool: name, callId, ...metadata })] });
  const updateContact = async (contact: Contact): Promise<Contact> => {
    const result = await apply("CONTACT_UPDATED", { businessId, contacts: [contact],
      outbox: [outbox(detail, "UPSERT_CONTACT", `${key}:crm`, { contactId: contact.id })] }, { contactId: contact.id });
    return result.contacts.find((item) => item.id === contact.id) ?? contact;
  };

  switch (name) {
    case "create_contact": return runtime.salesOrchestrator.createContact({
      businessId, name: optionalString(input.name, "name", 200), phone: string(input.phone, "phone", 64),
      roles: listedRoles(input.roles), isDecisionMaker: input.isDecisionMaker === true,
      preferredLanguage: language(input.preferredLanguage), source: "OUTBOUND_CALL",
      verified: false, idempotencyKey: key,
    });
    case "identify_contact": {
      const contact = contactFor(detail, input.contactId);
      if (boundCall.contactId !== contact.id) {
        throw new VoiceToolError(409, "IDENTITY_NOT_VERIFIED", "Voice identification requires a call bound to that contact.");
      }
      if (input.isDecisionMaker === true && boundCall.direction !== "INBOUND") {
        throw new VoiceToolError(409, "IDENTITY_NOT_VERIFIED", "A decision maker must call from the stored number or be verified by a founder.");
      }
      return runtime.salesOrchestrator.identifyContact({
        businessId, contactId: contact.id,
        name: optionalString(input.name, "name", 200), roles: listedRoles(input.roles),
        isDecisionMaker: input.isDecisionMaker === true,
        preferredLanguage: language(input.preferredLanguage), idempotencyKey: key,
      });
    }
    case "update_contact": {
      const contact = contactFor(detail, input.contactId);
      return updateContact({ ...contact, name: input.name === undefined ? contact.name : optionalString(input.name, "name", 200),
        preferredLanguage: input.preferredLanguage === undefined ? contact.preferredLanguage : language(input.preferredLanguage),
        updatedAt: new Date().toISOString() });
    }
    case "set_contact_role": {
      const contact = contactFor(detail, input.contactId);
      const nextRoles = listedRoles(input.roles);
      if (nextRoles.some((role) => ["OWNER", "CO_OWNER", "DECISION_MAKER"].includes(role)) &&
        (boundCall.contactId !== contact.id || boundCall.direction !== "INBOUND")) {
        throw new VoiceToolError(409, "IDENTITY_NOT_VERIFIED", "Voice role elevation requires a bound inbound call from the contact.");
      }
      return updateContact({ ...contact, roles: nextRoles, isDecisionMaker: nextRoles.some((role) => ["OWNER", "CO_OWNER", "DECISION_MAKER"].includes(role)), updatedAt: new Date().toISOString() });
    }
    case "mark_decision_maker": {
      const contact = contactFor(detail, input.contactId);
      if (boundCall.contactId !== contact.id || boundCall.direction !== "INBOUND") {
        throw new VoiceToolError(409, "IDENTITY_NOT_VERIFIED", "Decision-maker verification requires a bound inbound call from the contact.");
      }
      return updateContact({ ...contact, roles: [...new Set([...contact.roles.filter((role) => role !== "UNKNOWN"), "DECISION_MAKER" as const])],
        isDecisionMaker: true, verified: true, updatedAt: new Date().toISOString() });
    }
    case "save_call_context": {
      const call = detail.calls.find((item) => item.id === callId)!;
      const summary = string(input.summary, "summary", 4_000);
      return apply("CALL_CONNECTED", { businessId,
        calls: [{ ...call, status: call.status === "RINGING" ? "IN_PROGRESS" : call.status,
          summary, transcript: optionalString(input.transcript, "transcript", 20_000) ?? call.transcript,
          language: language(input.language) ?? call.language, updatedAt: new Date().toISOString() }],
        memory: memory(detail, { summary, lastContactId: call.contactId }) }, { summarySaved: true });
    }
    case "save_sales_summary": {
      const call = detail.calls.find((item) => item.id === callId)!;
      const summary = string(input.summary, "summary", 4_000);
      const now = new Date().toISOString();
      return apply("CALL_COMPLETED", { businessId,
        calls: [{ ...call, status: "COMPLETED", outcome: call.outcome ?? "UNKNOWN", summary, endedAt: call.endedAt ?? now, updatedAt: now }],
        memory: memory(detail, { summary, lastContactId: call.contactId }),
        outbox: [outbox(detail, "SYNC_CALL", `${key}:crm`, { callId })] }, { summarySaved: true });
    }
    case "add_objection": {
      const objection = string(input.objection, "objection", 500);
      return apply("OBJECTION_RECORDED", { businessId,
        memory: memory(detail, { objections: [...(detail.memory?.objections ?? []), objection] }) }, { objection });
    }
    case "save_requirement": {
      const field = string(input.field, "field", 80);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) throw new VoiceToolError(400, "VALIDATION_ERROR", "field must be an identifier.");
      const value = input.value;
      if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") throw new VoiceToolError(400, "VALIDATION_ERROR", "Requirement value must be scalar.");
      if (typeof value === "string" && value.length > 2_000) throw new VoiceToolError(400, "VALIDATION_ERROR", "Requirement value is too long.");
      return apply("REQUIREMENT_CAPTURED", { businessId,
        memory: memory(detail, { requirements: { ...(detail.memory?.requirements ?? {}), [field]: value } }) }, { field });
    }
    case "schedule_callback": return runtime.salesOrchestrator.scheduleFollowUp({
      businessId, contactId: input.contactId == null ? null : id(input.contactId, "contactId"),
      type: input.type === "OUTBOUND_CALL" ? "OUTBOUND_CALL" : "AWAIT_INBOUND_CALL",
      scheduledAt: string(input.scheduledAt, "scheduledAt", 64),
      reason: string(input.reason, "reason", 1_000), idempotencyKey: key,
    });
    case "create_quote": {
      const campaign = await runtime.store.getCampaign(typeof input.campaignId === "string" ? input.campaignId : "campaign-stage-1-demo");
      if (!campaign) throw new VoiceToolError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
      const quotedPrice = number(input.quotedPrice, "quotedPrice");
      const agreedPrice = input.agreedPrice == null ? null : number(input.agreedPrice, "agreedPrice");
      const policy = campaign.pricingPolicy;
      if (quotedPrice < policy.minimumPrice || quotedPrice > policy.maximumPrice ||
        (agreedPrice !== null && (agreedPrice > quotedPrice || agreedPrice < Math.max(policy.minimumPrice, Math.ceil(quotedPrice * (1 - policy.maximumDiscountPercent / 100)))))) {
        throw new VoiceToolError(409, "PRICE_OUTSIDE_POLICY", "Quote is outside campaign pricing policy.");
      }
      if (detail.business.salesState !== "NEGOTIATING" && detail.business.salesState !== "QUOTE_PRESENTED") throw new VoiceToolError(409, "INVALID_SALES_STATE", "A quote requires negotiation.");
      const transition = detail.business.salesState === "NEGOTIATING"
        ? stateMachine.transition({ businessId, currentState: "NEGOTIATING", targetState: "QUOTE_PRESENTED", actor: "VOICE_AGENT", reason: "Governed quote presented.", idempotencyKey: `${key}:transition` }, detail.transitions).transition : null;
      return apply("QUOTE_CREATED", { businessId,
        ...(transition ? { expectedState: "NEGOTIATING" as const, nextState: "QUOTE_PRESENTED" as const,
          transitions: [transition], events: [event(detail, "SALES_STATE_CHANGED", `${key}:stage`, { from: "NEGOTIATING", to: "QUOTE_PRESENTED" })] } : {}),
        memory: memory(detail, { quotedPrice, agreedPrice, dealStage: "QUOTE_PRESENTED" }),
        outbox: [outbox(detail, "SYNC_QUOTE", `${key}:crm`, { quotedPrice, agreedPrice })] }, { quotedPrice, agreedPrice });
    }
    case "update_deal_stage": {
      const target = string(input.targetState, "targetState", 64) as SalesState;
      if (!mutableStages.has(target)) throw new VoiceToolError(400, "INVALID_TARGET_STATE", "This tool cannot set a terminal or delivery state.");
      const transition = stateMachine.transition({ businessId, currentState: detail.business.salesState, targetState: target,
        actor: "VOICE_AGENT", reason: string(input.reason, "reason", 1_000), idempotencyKey: `${key}:transition` }, detail.transitions).transition;
      return apply("SALES_STATE_CHANGED", { businessId, expectedState: detail.business.salesState, nextState: target,
        transitions: [transition], memory: memory(detail, { dealStage: target }) }, { from: detail.business.salesState, to: target });
    }
    case "mark_deal_won": {
      const campaign = await runtime.store.getCampaign(typeof input.campaignId === "string" ? input.campaignId : "campaign-stage-1-demo");
      if (!campaign) throw new VoiceToolError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
      return runtime.salesOrchestrator.recordDealWon({ businessId, callId,
        decisionMakerContactId: id(input.decisionMakerContactId, "decisionMakerContactId"),
        summary: string(input.summary, "summary", 4_000),
        publicBusinessPhone: string(input.publicBusinessPhone, "publicBusinessPhone", 64),
        customerEmail: optionalString(input.customerEmail, "customerEmail", 254),
        objections: Array.isArray(input.objections) ? input.objections.map((item) => string(item, "objection", 500)) : [],
        requirements: requirements(input.requirements), branding: input.branding == null ? {} : object(input.branding, "branding"),
        quotedPrice: number(input.quotedPrice, "quotedPrice"), agreedPrice: number(input.agreedPrice, "agreedPrice"),
        campaign, language: language(input.language), transcript: optionalString(input.transcript, "transcript", 20_000), idempotencyKey: key,
      });
    }
    case "mark_deal_lost": {
      const reason = string(input.reason, "reason", 1_000);
      const transition = stateMachine.transition({ businessId, currentState: detail.business.salesState, targetState: "DEAL_LOST",
        actor: "VOICE_AGENT", reason, idempotencyKey: `${key}:transition` }, detail.transitions).transition;
      return apply("DEAL_LOST", { businessId, expectedState: detail.business.salesState, nextState: "DEAL_LOST",
        transitions: [transition], memory: memory(detail, { dealStage: "DEAL_LOST", nextAction: null, nextActionAt: null }),
        outbox: [outbox(detail, "SYNC_DEAL_STAGE", `${key}:crm`, { stage: "DEAL_LOST" })] }, { reason });
    }
    case "mark_do_not_contact": return runtime.salesOrchestrator.markDoNotContact(businessId, string(input.reason, "reason", 1_000), key, "VOICE_AGENT");
    case "generate_project_spec": {
      if (!detail.projectSpec) throw new VoiceToolError(409, "DEAL_NOT_WON", "A project specification requires an accepted deal.");
      await apply("SPEC_GENERATED", { businessId }, { specId: detail.projectSpec.id, existing: true });
      return detail.projectSpec;
    }
    case "sync_freshworks": {
      const operation = input.operation == null ? "UPSERT_BUSINESS" : string(input.operation, "operation", 64);
      const allowed = new Set<CRMOutboxOperation>(["UPSERT_BUSINESS", "UPSERT_CONTACT", "SYNC_CALL", "SYNC_FOLLOW_UP", "SYNC_REQUIREMENTS", "SYNC_QUOTE", "SYNC_DEAL_STAGE"]);
      if (!allowed.has(operation as CRMOutboxOperation)) throw new VoiceToolError(400, "VALIDATION_ERROR", "Unsupported CRM operation.");
      const payload: Record<string, unknown> = { businessId, callId };
      if (operation === "UPSERT_CONTACT") payload.contactId = contactFor(detail, input.contactId).id;
      if (operation === "SYNC_FOLLOW_UP") {
        const followUpId = id(input.followUpId, "followUpId");
        if (!detail.followUps.some((item) => item.id === followUpId)) throw new VoiceToolError(404, "FOLLOWUP_NOT_FOUND", "Follow-up does not belong to this business.");
        payload.followUpId = followUpId;
      }
      if (operation === "SYNC_REQUIREMENTS") {
        if (!detail.projectSpec) throw new VoiceToolError(409, "SPEC_NOT_FOUND", "No approved requirements exist for CRM sync.");
        payload.specId = detail.projectSpec.id;
      }
      if (operation === "SYNC_DEAL_STAGE") {
        if (["DEAL_WON", "SPEC_GENERATED", "BUILD_PENDING", "BUILDING", "QA", "DEPLOYING", "DEPLOYED"].includes(detail.business.salesState)) payload.stage = "DEAL_WON";
        else if (detail.business.salesState === "DEAL_LOST") payload.stage = "DEAL_LOST";
        else throw new VoiceToolError(409, "DEAL_STAGE_NOT_FINAL", "Only a persisted won/lost stage can be queued for CRM sync.");
      }
      return apply("CRM_SYNC_QUEUED", { businessId,
        outbox: [outbox(detail, operation as CRMOutboxOperation, `${key}:crm`, payload)] }, { operation });
    }
    default: throw new VoiceToolError(404, "UNKNOWN_TOOL", "Unknown voice tool.");
  }
}

export async function handleVoiceToolRoute(runtime: ApiRuntime, request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (!pathname.startsWith("/api/voice/tools/")) return false;
  try {
    if (request.method !== "POST") throw new VoiceToolError(405, "METHOD_NOT_ALLOWED", "Voice tools accept POST only.");
    const name = pathname.slice("/api/voice/tools/".length);
    if (!names.has(name)) throw new VoiceToolError(404, "UNKNOWN_TOOL", "Unknown voice tool.");
    let raw = "";
    for await (const chunk of request) {
      raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      if (Buffer.byteLength(raw) > 64_000) throw new VoiceToolError(413, "PAYLOAD_TOO_LARGE", "Voice tool request exceeds 64 KB.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new VoiceToolError(400, "INVALID_JSON", "Request body must be JSON."); }
    const body = object(parsed, "body");
    const businessId = id(body.businessId, "businessId");
    const callId = id(body.callId, "callId");
    const providerCallId = string(body.providerCallId, "providerCallId", 160);
    const key = string(body.idempotencyKey, "idempotencyKey", 256);
    const input = object(body.input, "input");
    const detail = await runtime.salesRepository.getDetail(businessId);
    if (!detail) throw new VoiceToolError(404, "BUSINESS_NOT_FOUND", "Business was not found.");
    const call = detail.calls.find((item) => item.id === callId && item.businessId === businessId && item.providerCallId === providerCallId);
    if (!call) throw new VoiceToolError(409, "CALL_CORRELATION_FAILED", "Call, provider call ID, and business do not match.");
    if (detail.business.salesState === "DO_NOT_CONTACT" && name !== "generate_project_spec") throw new VoiceToolError(409, "DO_NOT_CONTACT", "This business opted out of contact.");
    const replayKeys = name === "identify_contact" ? [key, `${key}:identified`]
      : name === "create_contact" || name === "schedule_callback" || name === "mark_do_not_contact"
        ? [key, `${key}:event`] : [key];
    const replay = detail.events.find((item) => replayKeys.includes(item.idempotencyKey));
    if (replay) { send(response, 200, { replayed: true, event: replay }); return true; }
    const result = await execute(runtime, name, detail, callId, input, key);
    send(response, 200, { tool: name, businessId, callId, result });
  } catch (error) {
    if (error instanceof VoiceToolError) fail(response, error.status, error.code, error.message);
    else if (error instanceof TypeError) fail(response, 400, "VALIDATION_ERROR", error.message);
    else {
      const message = error instanceof Error ? error.message : "Unknown voice tool error.";
      process.stderr.write(`${JSON.stringify({ level: "error", event: "voice.tool.failed", route: pathname, message, at: new Date().toISOString() })}\n`);
      fail(response, 409, "VOICE_TOOL_REJECTED", "The tool action was rejected. Review call state and retry safely.");
    }
  }
  return true;
}
