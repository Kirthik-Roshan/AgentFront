import type { IncomingMessage, ServerResponse } from "node:http";
import { InMemorySalesRepository } from "@agentfront/database";
import type {
  ContactRole, FollowUpType, SalesBusinessDetail, SalesOverview,
  SupportedSalesLanguage,
} from "@agentfront/types";
import { normalizePhoneToE164, SalesPolicyViolationError } from "@agentfront/orchestration";
import type { ApiRuntime } from "./runtime";

class SalesHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const contactRoles = new Set<ContactRole>(["OWNER", "CO_OWNER", "MANAGER", "DECISION_MAKER", "RECEPTIONIST", "EMPLOYEE", "UNKNOWN"]);
const languages = new Set<SupportedSalesLanguage>(["ENGLISH", "HINDI", "TAMIL", "KANNADA", "TELUGU", "MALAYALAM"]);
const followUpTypes = new Set<FollowUpType>(["OUTBOUND_CALL", "AWAIT_INBOUND_CALL", "WHATSAPP", "EMAIL", "HUMAN_TASK"]);
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function send(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify({ ok: true, data }));
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify({ ok: false, error: { code, message } }));
}

function routeId(encoded: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(encoded); } catch { throw new SalesHttpError(400, "VALIDATION_ERROR", "Malformed route identifier."); }
  if (!identifier.test(decoded)) throw new SalesHttpError(400, "VALIDATION_ERROR", "Unsupported route identifier.");
  return decoded;
}

function record(value: unknown, field = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SalesHttpError(400, "VALIDATION_ERROR", `${field} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new SalesHttpError(400, "VALIDATION_ERROR", `${field} must be a non-empty string of at most ${max} characters.`);
  return value.trim();
}

function optionalString(value: unknown, field: string, max = 2_000): string | null {
  return value === undefined || value === null ? null : string(value, field, max);
}

function enumValue<T extends string>(value: unknown, field: string, values: ReadonlySet<T>): T {
  const result = string(value, field, 64) as T;
  if (!values.has(result)) throw new SalesHttpError(400, "VALIDATION_ERROR", `${field} has an unsupported value.`);
  return result;
}

function roles(value: unknown): ContactRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new SalesHttpError(400, "VALIDATION_ERROR", "roles must contain 1–4 values.");
  return [...new Set(value.map((role) => enumValue(role, "role", contactRoles)))];
}

function idempotencyKey(request: IncomingMessage): string {
  const header = request.headers["idempotency-key"];
  if (typeof header !== "string") throw new SalesHttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
  return string(header, "Idempotency-Key", 256);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of request) {
    text += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(text) > 64_000) throw new SalesHttpError(413, "PAYLOAD_TOO_LARGE", "Sales request exceeds 64 KB.");
  }
  if (!text) return {};
  try { return record(JSON.parse(text) as unknown); } catch (error) {
    if (error instanceof SalesHttpError) throw error;
    throw new SalesHttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function overview(details: SalesBusinessDetail[], qualifiedLeadBusinessIds: ReadonlySet<string>): SalesOverview {
  const calls = details.flatMap((detail) => detail.calls);
  const contacts = details.flatMap((detail) => detail.contacts);
  const won = details.filter((detail) => ["DEAL_WON", "SPEC_GENERATED", "BUILD_PENDING", "BUILDING", "QA", "DEPLOYING", "DEPLOYED"].includes(detail.business.salesState)).length;
  const qualified = details.filter((detail) => qualifiedLeadBusinessIds.has(detail.business.id) || detail.business.salesState !== "DISCOVERED").length;
  return {
    totalBusinesses: details.length,
    qualifiedBusinesses: qualified,
    callsQueued: calls.filter((call) => call.status === "QUEUED" || call.status === "INITIATING").length,
    callsAttempted: calls.filter((call) => call.direction === "OUTBOUND").length,
    callsActive: calls.filter((call) => ["RINGING", "IN_PROGRESS"].includes(call.status)).length,
    receptionistContacts: contacts.filter((contact) => contact.roles.includes("RECEPTIONIST")).length,
    decisionMakersIdentified: contacts.filter((contact) => contact.isDecisionMaker).length,
    callbacksScheduled: details.flatMap((detail) => detail.followUps).filter((item) => item.status === "SCHEDULED").length,
    negotiationsActive: details.filter((detail) => ["NEGOTIATING", "QUOTE_PRESENTED"].includes(detail.business.salesState)).length,
    dealsWon: won,
    dealsLost: details.filter((detail) => detail.business.salesState === "DEAL_LOST").length,
    conversionRate: qualified ? Math.round((won / qualified) * 10_000) / 100 : 0,
  };
}

function sanitizeCallerResolution(result: Awaited<ReturnType<ApiRuntime["salesOrchestrator"]["handleInboundCall"]>>): unknown {
  if (result.status !== "RESOLVED") return result;
  // The founder API may inspect the full context; the voice-facing path must
  // still use `disclosureAllowed` before speaking any private detail aloud.
  return result;
}

/** Called only after the parent router has authenticated the founder session. */
export async function handleSalesRoute(
  runtime: ApiRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!pathname.startsWith("/api/sales/")) return false;
  try {
    if (request.method === "GET" && pathname === "/api/sales/overview") {
      const [allDetails, leads] = await Promise.all([runtime.salesRepository.list({ limit: 500 }), runtime.store.list()]);
      const details = allDetails.filter((detail) => detail.business.source === "GOOGLE_PLACES" || detail.business.id === "business-spiceroute");
      const qualified = new Set(leads.filter((item) => item.lead.status !== "REJECTED").map((item) => item.business.id));
      send(response, 200, { metrics: overview(details, qualified), businesses: details.map((detail) => ({
        business: detail.business,
        contacts: detail.contacts,
        activeCall: detail.calls.find((call) => ["QUEUED", "INITIATING", "RINGING", "IN_PROGRESS"].includes(call.status)) ?? null,
        lastCall: detail.calls[0] ?? null,
        nextFollowUp: detail.followUps.find((item) => item.status === "SCHEDULED") ?? null,
        memory: detail.memory,
        projectSpec: detail.projectSpec,
      })) });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/sales/inbound") {
      if (runtime.telephony.mode !== "DEMO") throw new SalesHttpError(503, "TELEPHONY_UNAVAILABLE", "No verified real inbound telephony adapter is installed.");
      const body = await readBody(request);
      const result = await runtime.salesOrchestrator.handleInboundCall({
        callerPhone: string(body.callerPhone, "callerPhone", 64),
        providerCallId: string(body.providerCallId, "providerCallId", 160),
        idempotencyKey: idempotencyKey(request),
      });
      send(response, 200, { mode: "DEMO", label: "SIMULATED TELEPHONY", resolution: sanitizeCallerResolution(result) });
      return true;
    }

    const detailMatch = pathname.match(/^\/api\/sales\/businesses\/([^/]+)(?:\/(.*))?$/);
    if (!detailMatch) throw new SalesHttpError(404, "NOT_FOUND", "Unknown sales route.");
    const businessId = routeId(detailMatch[1]!);
    const action = detailMatch[2] ?? "";
    if (request.method === "GET" && !action) {
      const detail = await runtime.salesRepository.getDetail(businessId);
      if (!detail) throw new SalesHttpError(404, "BUSINESS_NOT_FOUND", "Business was not found.");
      send(response, 200, detail);
      return true;
    }
    if (request.method === "GET" && action === "project_spec.json") {
      const detail = await runtime.salesRepository.getDetail(businessId);
      if (!detail?.projectSpec) throw new SalesHttpError(404, "PROJECT_SPEC_NOT_FOUND", "No accepted project specification exists yet.");
      send(response, 200, detail.projectSpec.specification);
      return true;
    }
    if (request.method !== "POST") throw new SalesHttpError(405, "METHOD_NOT_ALLOWED", "Unsupported sales method.");
    const key = idempotencyKey(request);
    const body = await readBody(request);

    if (action === "queue") {
      const business = await runtime.store.getBusiness(businessId);
      const campaign = await runtime.store.getCampaign(typeof body.campaignId === "string" ? body.campaignId : "campaign-stage-1-demo");
      if (!business || !campaign) throw new SalesHttpError(404, "BUSINESS_OR_CAMPAIGN_NOT_FOUND", "Business or campaign was not found.");
      let lead = await runtime.store.findByBusinessAndCampaign(business.id, campaign.id);
      if (!lead) lead = await runtime.orchestrator.start({ business, campaign, idempotencyKey: `${key}:qualification` });
      if (lead.lead.status === "REJECTED") throw new SalesHttpError(409, "LEAD_NOT_QUALIFIED", "The business did not pass campaign qualification.");
      if (runtime.salesRepository instanceof InMemorySalesRepository) runtime.salesRepository.registerBusiness(business);
      send(response, 202, await runtime.salesOrchestrator.queueLead(businessId, key));
      return true;
    }
    if (action === "call") {
      if (await runtime.controlTower?.emergencyStopped() ?? runtime.environmentEmergencyStopped) {
        throw new SalesHttpError(409, "EMERGENCY_STOPPED", "New sales calls are paused by the global emergency stop.");
      }
      const business = await runtime.store.getBusiness(businessId);
      if (!business) throw new SalesHttpError(404, "BUSINESS_NOT_FOUND", "Business was not found.");
      if (business.source === "GOOGLE_PLACES" && !business.phone) {
        throw new SalesHttpError(409, "PHONE_REQUIRED", "Google Places did not return a callable phone number for this business.");
      }
      if (runtime.telephony.mode === "REAL" && business.source === "GOOGLE_PLACES") {
        const approvedPhone = optionalString(body.approvedPhone, "approvedPhone", 64);
        let approvalMatches = false;
        try {
          approvalMatches = body.founderApproved === true && Boolean(approvedPhone) &&
            normalizePhoneToE164(approvedPhone!) === normalizePhoneToE164(business.phone!);
        } catch { approvalMatches = false; }
        if (!approvalMatches) {
          throw new SalesHttpError(409, "FOUNDER_APPROVAL_REQUIRED", "Confirm the selected Google Places phone before calling this business.");
        }
      }
      const campaign = await runtime.store.getCampaign(typeof body.campaignId === "string" ? body.campaignId : "campaign-stage-1-demo");
      if (!campaign) throw new SalesHttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
      const configuredPrice = businessId === (environment.SARVAM_ALLOWED_BUSINESS_ID?.trim() || "business-spiceroute")
        ? Number(environment.SPICEROUTE_DEMO_PRICE_INR)
        : Number.NaN;
      const callCampaign = Number.isSafeInteger(configuredPrice) && configuredPrice > 0
        ? { ...campaign, pricingPolicy: { ...campaign.pricingPolicy,
            basePrice: configuredPrice, minimumPrice: configuredPrice,
            maximumPrice: configuredPrice, maximumDiscountPercent: 0 } }
        : campaign;
      const call = await runtime.salesOrchestrator.startOutboundCall({
        businessId, campaign: callCampaign, contactId: optionalString(body.contactId, "contactId", 128),
        idempotencyKey: key,
        allowDemoOutsideWindow: body.allowDemoOutsideWindow === true,
        founderApproved: body.founderApproved === true,
        approvedPhone: optionalString(body.approvedPhone, "approvedPhone", 64),
      });
      send(response, 201, { call, mode: runtime.telephony.mode, label: runtime.telephony.mode === "DEMO" ? "SIMULATED TELEPHONY" : runtime.telephony.name });
      return true;
    }
    const releaseCall = action.match(/^calls\/([^/]+)\/release-stale$/);
    if (releaseCall) {
      const detail = await runtime.salesOrchestrator.expireUnconfirmedCall({
        businessId, callId: routeId(releaseCall[1]!), idempotencyKey: key,
      });
      send(response, 200, detail);
      return true;
    }
    if (action === "contacts") {
      const contact = await runtime.salesOrchestrator.createContact({
        businessId, name: optionalString(body.name, "name", 200), phone: string(body.phone, "phone", 64),
        roles: roles(body.roles), isDecisionMaker: body.isDecisionMaker === true,
        preferredLanguage: body.preferredLanguage == null ? null : enumValue(body.preferredLanguage, "preferredLanguage", languages),
        source: "FOUNDER", verified: body.verified === true, idempotencyKey: key,
      });
      send(response, 201, contact);
      return true;
    }
    const identify = action.match(/^contacts\/([^/]+)\/identify$/);
    if (identify) {
      const contact = await runtime.salesOrchestrator.identifyContact({
        businessId, contactId: routeId(identify[1]!), name: optionalString(body.name, "name", 200),
        roles: roles(body.roles), isDecisionMaker: body.isDecisionMaker === true,
        preferredLanguage: body.preferredLanguage == null ? null : enumValue(body.preferredLanguage, "preferredLanguage", languages),
        idempotencyKey: key,
      });
      send(response, 200, contact);
      return true;
    }
    if (action === "receptionist-handoff") {
      if (runtime.telephony.mode !== "DEMO") throw new SalesHttpError(409, "DEMO_ONLY", "This shortcut is available only for SIMULATED TELEPHONY.");
      const result = await runtime.salesOrchestrator.recordReceptionistHandoff({
        businessId, callId: string(body.callId, "callId", 128),
        receptionistName: optionalString(body.receptionistName, "receptionistName", 200),
        ownerName: string(body.ownerName, "ownerName", 200), ownerPhone: string(body.ownerPhone, "ownerPhone", 64),
        callbackAt: string(body.callbackAt, "callbackAt", 64), summary: string(body.summary, "summary", 4_000),
        preferredLanguage: body.preferredLanguage == null ? null : enumValue(body.preferredLanguage, "preferredLanguage", languages),
        idempotencyKey: key,
      });
      send(response, 200, { mode: "DEMO", label: "SIMULATED TELEPHONY", detail: result });
      return true;
    }
    if (action === "follow-ups") {
      const followUp = await runtime.salesOrchestrator.scheduleFollowUp({
        businessId, contactId: optionalString(body.contactId, "contactId", 128),
        type: enumValue(body.type, "type", followUpTypes),
        scheduledAt: string(body.scheduledAt, "scheduledAt", 64),
        reason: string(body.reason, "reason", 1_000), idempotencyKey: key,
      });
      send(response, 201, followUp);
      return true;
    }
    if (action === "do-not-contact") {
      send(response, 200, await runtime.salesOrchestrator.markDoNotContact(businessId, string(body.reason, "reason", 1_000), key));
      return true;
    }
    if (action === "deal-won") {
      const campaign = await runtime.store.getCampaign(typeof body.campaignId === "string" ? body.campaignId : "campaign-stage-1-demo");
      if (!campaign) throw new SalesHttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
      const requirements = record(body.requirements, "requirements");
      const pages = requirements.pages;
      if (!Array.isArray(pages) || pages.length < 1 || pages.length > 20 || pages.some((item) => typeof item !== "string" || !item.trim())) {
        throw new SalesHttpError(400, "VALIDATION_ERROR", "requirements.pages must contain 1–20 page names.");
      }
      const features = record(requirements.features, "requirements.features");
      if (Object.values(features).some((value) => typeof value !== "boolean")) throw new SalesHttpError(400, "VALIDATION_ERROR", "Feature values must be boolean.");
      const notes = requirements.notes === undefined ? [] : requirements.notes;
      if (!Array.isArray(notes) || notes.length > 50 || notes.some((item) => typeof item !== "string")) throw new SalesHttpError(400, "VALIDATION_ERROR", "requirements.notes must be strings.");
      if (!Number.isSafeInteger(body.quotedPrice) || !Number.isSafeInteger(body.agreedPrice)) throw new SalesHttpError(400, "VALIDATION_ERROR", "Prices must be integer rupees.");
      const result = await runtime.salesOrchestrator.recordDealWon({
        businessId, callId: string(body.callId, "callId", 128),
        decisionMakerContactId: string(body.decisionMakerContactId, "decisionMakerContactId", 128),
        summary: string(body.summary, "summary", 4_000),
        publicBusinessPhone: string(body.publicBusinessPhone, "publicBusinessPhone", 64),
        customerEmail: optionalString(body.customerEmail, "customerEmail", 254),
        objections: Array.isArray(body.objections) ? body.objections.map((item) => string(item, "objection", 500)) : [],
        requirements: { pages: pages as string[], features: features as Record<string, boolean>, notes: notes as string[] },
        branding: body.branding === undefined ? {} : record(body.branding, "branding"),
        quotedPrice: body.quotedPrice as number, agreedPrice: body.agreedPrice as number,
        campaign, language: body.language == null ? null : enumValue(body.language, "language", languages),
        transcript: optionalString(body.transcript, "transcript", 20_000), idempotencyKey: key,
      });
      send(response, 200, result);
      return true;
    }
    throw new SalesHttpError(404, "NOT_FOUND", "Unknown sales action.");
  } catch (error) {
    if (error instanceof SalesHttpError) sendError(response, error.status, error.code, error.message);
    else if (error instanceof SalesPolicyViolationError) sendError(response, error.code === "BUSINESS_NOT_FOUND" ? 404 : 409, error.code, error.message);
    else if (error instanceof TypeError) sendError(response, 400, "VALIDATION_ERROR", error.message);
    else {
      const message = error instanceof Error ? error.message : "Unknown sales operation error.";
      process.stderr.write(`${JSON.stringify({ level: "error", service: "agentfront-api", event: "sales.route.failed", route: pathname, message, at: new Date().toISOString() })}\n`);
      sendError(response, 500, "SALES_OPERATION_FAILED", "The sales operation failed before a call was accepted. Review the server log, correct the provider configuration, then retry the action.");
    }
    return true;
  }
}
