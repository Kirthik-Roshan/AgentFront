import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  Campaign,
  Contact,
  ContactRole,
  ContactSource,
  CRMOutboxItem,
  CRMOutboxOperation,
  FollowUp,
  FollowUpType,
  SalesBusinessDetail,
  SalesCall,
  SalesEvent,
  SalesEventType,
  SalesJob,
  SalesMemory,
  SalesProjectSpec,
  SalesProjectSpecification,
  SalesState,
  SalesStateTransitionRecord,
  SupportedSalesLanguage,
} from "@agentfront/types";
import { AgentEventBus } from "./events";
import { normalizePhoneToE164 } from "./phone";
import { evaluateOutboundCallEligibility } from "./sales-policy";
import type { SalesChange, SalesRepository } from "./sales-repository";
import { SalesStateMachine } from "./sales-state-machine";

/** A provider-neutral boundary; the integration adapter satisfies this shape. */
export interface SalesTelephonyPort {
  readonly name: string;
  readonly mode: "REAL" | "DEMO";
  makeOutboundCall(
    request: { businessId: string; contactId: string | null; to: string; founderApprovedDestination?: string; metadata?: Record<string, string>; agentVariables?: Record<string, string> },
    idempotencyKey: string,
  ): Promise<{ providerCallId: string; status: string; startedAt: string | null }>;
  terminateCall(callId: string): Promise<{ status: string; endedAt: string | null }>;
}

export interface SalesOrchestratorOptions {
  clock?: () => Date;
  blockedNumbers?: ReadonlySet<string>;
  maximumAttempts?: number;
  minimumMinutesBetweenAttempts?: number;
}

export type CallerResolution =
  | { status: "UNKNOWN_CALLER"; normalizedPhone: string; disclosureAllowed: false }
  | { status: "AMBIGUOUS"; normalizedPhone: string; matches: number; disclosureAllowed: false }
  | {
      status: "RESOLVED";
      normalizedPhone: string;
      contact: Contact;
      businessId: string;
      disclosureAllowed: boolean;
      context: SalesBusinessDetail;
    };

export interface CreateSalesContactInput {
  businessId: string;
  name: string | null;
  phone: string;
  roles: ContactRole[];
  isDecisionMaker: boolean;
  preferredLanguage?: SupportedSalesLanguage | null;
  source: ContactSource;
  verified?: boolean;
  idempotencyKey: string;
}

export interface ReceptionistHandoffInput {
  businessId: string;
  callId: string;
  receptionistName?: string | null;
  ownerName: string;
  ownerPhone: string;
  callbackAt: string;
  summary: string;
  preferredLanguage?: SupportedSalesLanguage | null;
  idempotencyKey: string;
}

export interface WonDealInput {
  businessId: string;
  callId: string;
  decisionMakerContactId: string;
  summary: string;
  publicBusinessPhone: string;
  customerEmail?: string | null;
  objections: string[];
  requirements: SalesProjectSpecification["requirements"];
  branding: Record<string, unknown>;
  quotedPrice: number;
  agreedPrice: number;
  campaign: Campaign;
  language?: SupportedSalesLanguage | null;
  transcript?: string | null;
  idempotencyKey: string;
}

export class SalesPolicyViolationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SalesPolicyViolationError";
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const activeCallStatuses = new Set(["QUEUED", "INITIATING", "RINGING", "IN_PROGRESS"]);
const iso = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid ISO timestamp is required.");
  return date.toISOString();
};
const nonEmpty = (value: string, label: string, maximum = 2_000): string => {
  const result = value.trim();
  if (!result || result.length > maximum) throw new TypeError(`${label} must contain 1–${maximum} characters.`);
  return result;
};

export class SalesOrchestrator {
  readonly #stateMachine = new SalesStateMachine();
  readonly #clock: () => Date;
  readonly #blockedNumbers: ReadonlySet<string>;
  readonly #maximumAttempts: number;
  readonly #minimumMinutesBetweenAttempts: number;

  constructor(
    readonly repository: SalesRepository,
    readonly telephony: SalesTelephonyPort,
    readonly events: AgentEventBus,
    options: SalesOrchestratorOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date());
    this.#blockedNumbers = options.blockedNumbers ?? new Set();
    this.#maximumAttempts = options.maximumAttempts ?? 3;
    this.#minimumMinutesBetweenAttempts = options.minimumMinutesBetweenAttempts ?? 5;
  }

  async queueLead(businessId: string, idempotencyKey: string): Promise<SalesBusinessDetail> {
    const detail = await this.#requireBusiness(businessId);
    if (detail.business.salesState === "DO_NOT_CONTACT") throw new SalesPolicyViolationError("DO_NOT_CONTACT", "This business opted out of contact.");
    if (detail.business.salesState === "CALL_PENDING") return detail;
    const path: SalesState[] = detail.business.salesState === "DISCOVERED"
      ? ["QUALIFIED", "CALL_PENDING"]
      : ["QUALIFIED", "CALLBACK_REQUESTED", "FOLLOW_UP_REQUIRED", "FOLLOW_UP_SCHEDULED", "OWNER_CONTACT_IDENTIFIED"].includes(detail.business.salesState)
        ? ["CALL_PENDING"] : [];
    if (path.length === 0) throw new SalesPolicyViolationError("INVALID_SALES_STATE", "The business cannot be queued from its current sales state.");
    const change = this.#statePath(detail, path, "SALES_ORCHESTRATOR", "Qualified lead queued for outreach.", idempotencyKey);
    // Qualification is intentionally separate from dialling. Initial calls
    // are started only by the authenticated founder action; queueing a lead
    // must never create an automatic outbound side effect.
    change.outbox = [this.#outbox(businessId, "SYNC_QUALIFICATION", { businessId }, `${idempotencyKey}:crm-qualification`)];
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated;
  }

  async createContact(input: CreateSalesContactInput): Promise<Contact> {
    const detail = await this.#requireBusiness(input.businessId);
    if (detail.business.salesState === "DO_NOT_CONTACT") throw new SalesPolicyViolationError("DO_NOT_CONTACT", "This business opted out of contact.");
    const dedupeKey = nonEmpty(input.idempotencyKey, "idempotencyKey", 256);
    const replay = detail.contacts.find((contact) => contact.dedupeKey === dedupeKey);
    if (replay) return replay;
    if (!Array.isArray(input.roles) || input.roles.length === 0 || input.roles.length > 4) throw new TypeError("At least one valid contact role is required.");
    const normalizedPhone = normalizePhoneToE164(input.phone);
    const now = this.#now();
    const contact: Contact = {
      id: randomUUID(),
      businessId: input.businessId,
      name: input.name ? nonEmpty(input.name, "contact name", 200) : null,
      phone: input.phone.trim(),
      normalizedPhone,
      roles: [...new Set(input.roles)],
      isDecisionMaker: input.isDecisionMaker,
      preferredLanguage: input.preferredLanguage ?? null,
      source: input.source,
      verified: input.verified ?? false,
      dedupeKey,
      createdAt: now,
      updatedAt: now,
    };
    const change: SalesChange = {
      businessId: input.businessId,
      contacts: [contact],
      events: [this.#event(input.businessId, "CONTACT_CREATED", { contactId: contact.id, roles: contact.roles }, `${dedupeKey}:event`)],
      outbox: [this.#outbox(input.businessId, "UPSERT_CONTACT", { contactId: contact.id }, `${dedupeKey}:crm-contact`)],
    };
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated.contacts.find((item) => item.id === contact.id) ?? contact;
  }

  async identifyContact(input: {
    businessId: string;
    contactId: string;
    name?: string | null;
    roles: ContactRole[];
    isDecisionMaker: boolean;
    preferredLanguage?: SupportedSalesLanguage | null;
    idempotencyKey: string;
  }): Promise<Contact> {
    const detail = await this.#requireBusiness(input.businessId);
    if (detail.business.salesState === "DO_NOT_CONTACT") throw new SalesPolicyViolationError("DO_NOT_CONTACT", "This business opted out of contact.");
    const contact = detail.contacts.find((item) => item.id === input.contactId);
    if (!contact) throw new SalesPolicyViolationError("CONTACT_NOT_FOUND", "Contact does not belong to the business.");
    if (!input.roles.length || input.roles.length > 4) throw new TypeError("At least one contact role is required.");
    const now = this.#now();
    const identified: Contact = {
      ...contact,
      name: input.name?.trim() || contact.name,
      roles: [...new Set(input.roles)],
      isDecisionMaker: input.isDecisionMaker,
      preferredLanguage: input.preferredLanguage ?? contact.preferredLanguage,
      verified: true,
      updatedAt: now,
    };
    const change: SalesChange = {
      businessId: input.businessId,
      contacts: [identified],
      events: [this.#event(input.businessId, identified.isDecisionMaker ? "OWNER_IDENTIFIED" : "CONTACT_IDENTIFIED", {
        contactId: identified.id, roles: identified.roles,
      }, `${input.idempotencyKey}:identified`)],
      outbox: [this.#outbox(input.businessId, "UPSERT_CONTACT", { contactId: identified.id }, `${input.idempotencyKey}:crm-contact`)],
    };
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated.contacts.find((item) => item.id === identified.id) ?? identified;
  }

  async startOutboundCall(input: {
    businessId: string;
    campaign: Campaign;
    contactId?: string | null;
    idempotencyKey: string;
    allowDemoOutsideWindow?: boolean;
    founderApproved?: boolean;
    approvedPhone?: string | null;
  }): Promise<SalesCall> {
    let detail = await this.#requireBusiness(input.businessId);
    const key = nonEmpty(input.idempotencyKey, "idempotencyKey", 256);
    const replay = detail.calls.find((call) => call.idempotencyKey === key);
    if (replay) return replay;
    if (detail.business.salesState === "QUALIFIED") detail = await this.queueLead(input.businessId, `${key}:queue`);
    const contact = input.contactId ? detail.contacts.find((item) => item.id === input.contactId) : null;
    if (input.contactId && !contact) throw new SalesPolicyViolationError("CONTACT_NOT_FOUND", "Contact does not belong to the business.");
    const phone = contact?.normalizedPhone ?? (detail.business.phone ? normalizePhoneToE164(detail.business.phone) : null);
    if (detail.business.source === "GOOGLE_PLACES" && this.telephony.mode === "REAL") {
      const approved = (() => {
        try { return input.approvedPhone ? normalizePhoneToE164(input.approvedPhone) : null; }
        catch { return null; }
      })();
      if (input.founderApproved !== true || !phone || approved !== phone) {
        throw new SalesPolicyViolationError("FOUNDER_APPROVAL_REQUIRED", "Exact founder approval is required for this discovered phone number.");
      }
    }
    const now = this.#now();
    const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: input.campaign.callingWindow.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const callsToday = detail.calls.filter((call) => call.direction === "OUTBOUND" &&
      new Intl.DateTimeFormat("en-CA", { timeZone: input.campaign.callingWindow.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(call.createdAt)) === localDay).length;
    const nextFollowUp = detail.followUps.find((followUp) => followUp.status === "SCHEDULED" && (!contact || followUp.contactId === contact.id));
    const eligibility = evaluateOutboundCallEligibility({
      salesState: detail.business.salesState,
      doNotContact: detail.business.salesState === "DO_NOT_CONTACT",
      numberBlocked: Boolean(phone && this.#blockedNumbers.has(phone)),
      hasCallablePhone: Boolean(phone),
      activeCallExists: detail.calls.some((call) => activeCallStatuses.has(call.status)),
      attempts: detail.calls.filter((call) => call.direction === "OUTBOUND").length,
      callsToday,
      scheduledAt: nextFollowUp?.scheduledAt ?? null,
      lastAttemptAt: detail.calls.filter((call) => call.direction === "OUTBOUND").at(-1)?.createdAt ?? null,
      now,
    }, {
      callingWindow: input.campaign.callingWindow,
      maximumCallsPerDay: input.campaign.maximumCallsPerDay,
      maximumAttempts: this.#maximumAttempts,
      minimumMinutesBetweenAttempts: this.#minimumMinutesBetweenAttempts,
    });
    if (!eligibility.allowed && !(eligibility.reason === "OUTSIDE_CALLING_WINDOW" &&
      input.allowDemoOutsideWindow === true && this.telephony.mode === "DEMO")) {
      throw new SalesPolicyViolationError(eligibility.reason, `Outbound call denied: ${eligibility.reason}.`);
    }
    if (!phone) throw new SalesPolicyViolationError("PHONE_REQUIRED", "A verified callable number is required.");

    const call: SalesCall = {
      id: randomUUID(), businessId: input.businessId, contactId: contact?.id ?? null,
      direction: "OUTBOUND", provider: this.telephony.name, providerCallId: null,
      providerMode: this.telephony.mode, status: "INITIATING", startedAt: null, endedAt: null,
      outcome: null, language: contact?.preferredLanguage ?? null, transcript: null,
      summary: null, recordingUrl: null, idempotencyKey: key,
      metadata: input.allowDemoOutsideWindow && this.telephony.mode === "DEMO"
        ? { simulatedOutsideCallingWindow: true, sarvamContextVersion: "sales-v2" } : { sarvamContextVersion: "sales-v2" },
      createdAt: now, updatedAt: now,
    };
    const change = this.#statePath(detail, ["CALLING"], "SALES_ORCHESTRATOR", "Outbound call reserved.", key);
    change.calls = [call];
    change.events?.push(this.#event(input.businessId, "CALL_STARTED", { callId: call.id, providerMode: call.providerMode }, `${key}:started`));
    await this.repository.applyChange(change);
    this.#publish(change.events ?? [], detail);
    try {
      const providerCall = await this.telephony.makeOutboundCall({
        businessId: input.businessId,
        contactId: contact?.id ?? null,
        to: phone,
        founderApprovedDestination: detail.business.source === "GOOGLE_PLACES" ? input.approvedPhone ?? undefined : undefined,
        metadata: { salesCallId: call.id },
        agentVariables: {
          business_id: detail.business.id,
          business_name: detail.business.name,
          category: detail.business.category,
          location: detail.business.address || detail.business.city,
          package_name: `${detail.business.category[0]?.toUpperCase() ?? ""}${detail.business.category.slice(1)} website package`,
          target_price: String(input.campaign.pricingPolicy.basePrice),
          floor_price: String(input.campaign.pricingPolicy.minimumPrice),
          currency: input.campaign.pricingPolicy.currency,
        },
      }, key);
      const updatedCall: SalesCall = {
        ...call,
        providerCallId: providerCall.providerCallId,
        status: providerCall.status === "IN_PROGRESS" ? "IN_PROGRESS" :
          providerCall.status === "RINGING" ? "RINGING" : "INITIATING",
        startedAt: providerCall.startedAt ?? now,
        updatedAt: this.#now(),
      };
      await this.repository.applyChange({ businessId: input.businessId, calls: [updatedCall] });
      return updatedCall;
    } catch (error) {
      const failedCall: SalesCall = {
        ...call, status: "FAILED", outcome: "FAILED", endedAt: this.#now(), updatedAt: this.#now(),
        summary: error instanceof Error ? error.message.slice(0, 500) : "Telephony provider failed.",
      };
      const fresh = await this.#requireBusiness(input.businessId);
      const failureChange = this.#statePath(fresh, ["FOLLOW_UP_REQUIRED"], "TELEPHONY", "Telephony provider failed.", `${key}:failure`);
      failureChange.calls = [failedCall];
      failureChange.events?.push(this.#event(input.businessId, "CALL_FAILED", { callId: call.id, provider: this.telephony.name }, `${key}:failed`));
      await this.repository.applyChange(failureChange);
      this.#publish(failureChange.events ?? [], fresh);
      throw error;
    }
  }

  async expireUnconfirmedCall(input: {
    businessId: string;
    callId: string;
    idempotencyKey: string;
    minimumAgeMinutes?: number;
  }): Promise<SalesBusinessDetail> {
    const detail = await this.#requireBusiness(input.businessId);
    const call = detail.calls.find((item) => item.id === input.callId);
    if (!call) throw new SalesPolicyViolationError("CALL_NOT_FOUND", "The call is not associated with this business.");
    if (!activeCallStatuses.has(call.status)) return detail;
    const minimumAgeMinutes = input.minimumAgeMinutes ?? 10;
    const ageMs = Date.parse(this.#now()) - Date.parse(call.updatedAt);
    if (!Number.isFinite(ageMs) || ageMs < minimumAgeMinutes * 60_000) {
      throw new SalesPolicyViolationError("CALL_NOT_STALE", `Wait ${minimumAgeMinutes} minutes before releasing an unconfirmed provider attempt.`);
    }
    if (detail.business.salesState !== "CALLING") {
      throw new SalesPolicyViolationError("INVALID_SALES_STATE", "Only a stale call in the calling state can be released.");
    }
    const now = this.#now();
    const change = this.#statePath(detail, ["FOLLOW_UP_REQUIRED"], "FOUNDER", "Provider accepted the attempt but no call progress webhook arrived.", input.idempotencyKey);
    change.calls = [{ ...call, status: "FAILED", outcome: "FAILED", endedAt: now, updatedAt: now,
      summary: "Released by the founder after no provider progress webhook arrived. Verify the attempt in Sarvam/Vobiz before retrying." }];
    change.events?.push(this.#event(input.businessId, "CALL_FAILED", {
      callId: call.id, provider: call.provider, reason: "PROVIDER_PROGRESS_TIMEOUT",
    }, `${input.idempotencyKey}:failed`));
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated;
  }

  async resolveCaller(phone: string): Promise<CallerResolution> {
    const normalizedPhone = normalizePhoneToE164(phone);
    const matches = await this.repository.findContactsByPhone(normalizedPhone);
    if (matches.length === 0) return { status: "UNKNOWN_CALLER", normalizedPhone, disclosureAllowed: false };
    if (matches.length > 1) return { status: "AMBIGUOUS", normalizedPhone, matches: matches.length, disclosureAllowed: false };
    const contact = matches[0]!;
    const context = await this.#requireBusiness(contact.businessId);
    return {
      status: "RESOLVED", normalizedPhone, contact, businessId: contact.businessId,
      disclosureAllowed: contact.verified && contact.isDecisionMaker,
      context,
    };
  }

  async handleInboundCall(input: {
    callerPhone: string;
    providerCallId: string;
    idempotencyKey: string;
  }): Promise<CallerResolution> {
    const resolution = await this.resolveCaller(input.callerPhone);
    if (resolution.status !== "RESOLVED") return resolution;
    const { context, contact } = resolution;
    const replay = context.calls.find((call) => call.idempotencyKey === input.idempotencyKey);
    if (replay) return resolution;
    const now = this.#now();
    const call: SalesCall = {
      id: randomUUID(), businessId: contact.businessId, contactId: contact.id,
      direction: "INBOUND", provider: this.telephony.name, providerCallId: nonEmpty(input.providerCallId, "providerCallId", 160),
      providerMode: this.telephony.mode, status: "IN_PROGRESS", startedAt: now, endedAt: null,
      outcome: null, language: contact.preferredLanguage, transcript: null, summary: null,
      recordingUrl: null, idempotencyKey: input.idempotencyKey,
      metadata: { identityConfidence: contact.verified ? "VERIFIED_CONTACT" : "PHONE_MATCH_ONLY" },
      createdAt: now, updatedAt: now,
    };
    const owner = contact.isDecisionMaker;
    const path = owner && ["FOLLOW_UP_SCHEDULED", "CALLBACK_REQUESTED", "OWNER_CONTACT_IDENTIFIED"].includes(context.business.salesState)
      ? ["OWNER_CONTACTED" as SalesState]
      : [];
    const change = this.#statePath(context, path, "TELEPHONY", "Known contact called AgentFront.", input.idempotencyKey);
    change.calls = [call];
    change.memory = this.#memory(context, { lastContactId: contact.id, dealStage: path.at(-1) ?? context.business.salesState });
    change.followUps = context.followUps.filter((item) => item.status === "SCHEDULED" && item.type === "AWAIT_INBOUND_CALL" && item.contactId === contact.id)
      .map((item) => ({ ...item, status: "COMPLETED", completedAt: now, updatedAt: now }));
    change.events?.push(this.#event(contact.businessId, "CALL_CONNECTED", { callId: call.id, contactId: contact.id, inbound: true }, `${input.idempotencyKey}:connected`));
    await this.repository.applyChange(change);
    this.#publish(change.events ?? [], context);
    return this.resolveCaller(input.callerPhone);
  }

  async recordReceptionistHandoff(input: ReceptionistHandoffInput): Promise<SalesBusinessDetail> {
    const detail = await this.#requireBusiness(input.businessId);
    const call = detail.calls.find((item) => item.id === input.callId);
    if (!call) throw new SalesPolicyViolationError("CALL_NOT_FOUND", "The call is not associated with this business.");
    if (detail.business.salesState === "DO_NOT_CONTACT") throw new SalesPolicyViolationError("DO_NOT_CONTACT", "This business opted out of contact.");
    if (call.status === "COMPLETED" && detail.events.some((event) => event.idempotencyKey === `${input.idempotencyKey}:handoff`)) return detail;
    const now = this.#now();
    const ownerPhone = normalizePhoneToE164(input.ownerPhone);
    const callbackAt = iso(input.callbackAt);
    if (Date.parse(callbackAt) <= Date.parse(now)) throw new TypeError("callbackAt must be in the future.");
    const publicPhone = detail.business.phone ? normalizePhoneToE164(detail.business.phone) : null;
    const receptionist = detail.contacts.find((item) => item.id === call.contactId) ?? (publicPhone ? detail.contacts.find((item) => item.normalizedPhone === publicPhone && item.roles.includes("RECEPTIONIST")) : null);
    const receptionistContact: Contact | null = receptionist ? {
      ...receptionist, name: input.receptionistName?.trim() || receptionist.name,
      roles: [...new Set([...receptionist.roles.filter((role) => role !== "UNKNOWN"), "RECEPTIONIST" as const])],
      isDecisionMaker: false, verified: true, updatedAt: now,
    } : publicPhone ? {
      id: randomUUID(), businessId: input.businessId, name: input.receptionistName?.trim() || null,
      phone: detail.business.phone!, normalizedPhone: publicPhone, roles: ["RECEPTIONIST"],
      isDecisionMaker: false, preferredLanguage: null, source: "OUTBOUND_CALL", verified: true,
      dedupeKey: `${input.idempotencyKey}:receptionist`, createdAt: now, updatedAt: now,
    } : null;
    const existingOwner = detail.contacts.find((item) => item.normalizedPhone === ownerPhone && item.isDecisionMaker);
    const owner: Contact = existingOwner ? { ...existingOwner, name: nonEmpty(input.ownerName, "ownerName", 200), updatedAt: now } : {
      id: randomUUID(), businessId: input.businessId, name: nonEmpty(input.ownerName, "ownerName", 200),
      phone: input.ownerPhone.trim(), normalizedPhone: ownerPhone, roles: ["OWNER"],
      isDecisionMaker: true, preferredLanguage: input.preferredLanguage ?? null,
      source: "RECEPTIONIST_REFERRAL", verified: false,
      dedupeKey: `${input.idempotencyKey}:owner`, createdAt: now, updatedAt: now,
    };
    const followUp: FollowUp = {
      id: randomUUID(), businessId: input.businessId, contactId: owner.id,
      type: "AWAIT_INBOUND_CALL", scheduledAt: callbackAt, status: "SCHEDULED",
      reason: "Owner will call AgentFront at the agreed time.", attempts: 0, maxAttempts: 3,
      lastAttemptAt: null, completedAt: null, dedupeKey: `${input.idempotencyKey}:owner-callback`,
      createdAt: now, updatedAt: now,
    };
    const path: SalesState[] = detail.business.salesState === "CALLING"
      ? ["CONTACTED", "RECEPTIONIST_CONTACTED", "OWNER_CONTACT_IDENTIFIED", "CALLBACK_REQUESTED", "FOLLOW_UP_SCHEDULED"]
      : detail.business.salesState === "CONTACTED"
        ? ["RECEPTIONIST_CONTACTED", "OWNER_CONTACT_IDENTIFIED", "CALLBACK_REQUESTED", "FOLLOW_UP_SCHEDULED"]
        : detail.business.salesState === "RECEPTIONIST_CONTACTED"
          ? ["OWNER_CONTACT_IDENTIFIED", "CALLBACK_REQUESTED", "FOLLOW_UP_SCHEDULED"] : [];
    if (path.length === 0) throw new SalesPolicyViolationError("INVALID_SALES_STATE", "Receptionist handoff is not valid in the current state.");
    const change = this.#statePath(detail, path, "VOICE_AGENT", "Receptionist provided the owner contact and callback plan.", input.idempotencyKey);
    change.contacts = receptionistContact ? [receptionistContact, owner] : [owner];
    change.calls = [{ ...call, status: "COMPLETED", outcome: "OWNER_CONTACT_CAPTURED", summary: nonEmpty(input.summary, "summary", 4_000), endedAt: now, updatedAt: now, contactId: receptionistContact?.id ?? call.contactId }];
    change.followUps = [followUp];
    change.memory = this.#memory(detail, {
      summary: input.summary, nextAction: "Await owner inbound callback", nextActionAt: callbackAt,
      lastContactId: owner.id, dealStage: "FOLLOW_UP_SCHEDULED",
    });
    change.events?.push(
      this.#event(input.businessId, "RECEPTIONIST_IDENTIFIED", { callId: call.id, contactId: receptionistContact?.id ?? null }, `${input.idempotencyKey}:receptionist-event`),
      this.#event(input.businessId, "OWNER_CONTACT_CREATED", { contactId: owner.id }, `${input.idempotencyKey}:owner-event`),
      this.#event(input.businessId, "FOLLOWUP_SCHEDULED", { followUpId: followUp.id, scheduledAt: callbackAt }, `${input.idempotencyKey}:handoff`),
    );
    change.outbox = [
      this.#outbox(input.businessId, "UPSERT_CONTACT", { contactId: owner.id }, `${input.idempotencyKey}:crm-owner`),
      this.#outbox(input.businessId, "SYNC_CALL", { callId: call.id }, `${input.idempotencyKey}:crm-call`),
      this.#outbox(input.businessId, "SYNC_FOLLOW_UP", { followUpId: followUp.id }, `${input.idempotencyKey}:crm-callback`),
    ];
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated;
  }

  async scheduleFollowUp(input: {
    businessId: string; contactId: string | null; type: FollowUpType;
    scheduledAt: string; reason: string; idempotencyKey: string;
  }): Promise<FollowUp> {
    const detail = await this.#requireBusiness(input.businessId);
    if (detail.business.salesState === "DO_NOT_CONTACT") throw new SalesPolicyViolationError("DO_NOT_CONTACT", "This business opted out of contact.");
    const replay = detail.followUps.find((item) => item.dedupeKey === input.idempotencyKey);
    if (replay) return replay;
    if (input.contactId && !detail.contacts.some((item) => item.id === input.contactId)) throw new SalesPolicyViolationError("CONTACT_NOT_FOUND", "Contact does not belong to the business.");
    const scheduledAt = iso(input.scheduledAt);
    if (Date.parse(scheduledAt) <= Date.parse(this.#now())) throw new TypeError("scheduledAt must be in the future.");
    const now = this.#now();
    const followUp: FollowUp = {
      id: randomUUID(), businessId: input.businessId, contactId: input.contactId,
      type: input.type, scheduledAt, status: "SCHEDULED", reason: nonEmpty(input.reason, "reason", 1_000),
      attempts: 0, maxAttempts: 3, lastAttemptAt: null, completedAt: null,
      dedupeKey: input.idempotencyKey, createdAt: now, updatedAt: now,
    };
    const path: SalesState[] = detail.business.salesState === "CALLBACK_REQUESTED" || detail.business.salesState === "FOLLOW_UP_REQUIRED"
      ? ["FOLLOW_UP_SCHEDULED"]
      : detail.business.salesState === "OWNER_CONTACTED" || detail.business.salesState === "DISCOVERY_CONVERSATION" || detail.business.salesState === "REQUIREMENTS_COLLECTING" || detail.business.salesState === "NEGOTIATING" || detail.business.salesState === "QUOTE_PRESENTED"
        ? ["CALLBACK_REQUESTED", "FOLLOW_UP_SCHEDULED"]
        : [];
    const change = this.#statePath(detail, path, "SALES_ORCHESTRATOR", "Follow-up scheduled.", input.idempotencyKey);
    change.followUps = [followUp];
    change.memory = this.#memory(detail, {
      nextAction: input.reason, nextActionAt: scheduledAt, lastContactId: input.contactId,
      dealStage: path.at(-1) ?? detail.business.salesState,
    });
    change.events?.push(this.#event(input.businessId, "FOLLOWUP_SCHEDULED", { followUpId: followUp.id, scheduledAt }, `${input.idempotencyKey}:event`));
    change.outbox = [this.#outbox(input.businessId, "SYNC_FOLLOW_UP", { followUpId: followUp.id }, `${input.idempotencyKey}:crm`)];
    if (input.type === "OUTBOUND_CALL") change.jobs = [this.#job(input.businessId, "PROCESS_FOLLOW_UP", { followUpId: followUp.id }, `${input.idempotencyKey}:job`, scheduledAt)];
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated.followUps.find((item) => item.id === followUp.id) ?? followUp;
  }

  async markDoNotContact(businessId: string, reason: string, idempotencyKey: string, actor: "FOUNDER" | "VOICE_AGENT" = "FOUNDER"): Promise<SalesBusinessDetail> {
    const detail = await this.#requireBusiness(businessId);
    if (detail.business.salesState === "DO_NOT_CONTACT") return detail;
    const change = this.#statePath(detail, ["DO_NOT_CONTACT"], actor, nonEmpty(reason, "reason", 1_000), idempotencyKey);
    const now = this.#now();
    change.followUps = detail.followUps.filter((item) => item.status === "SCHEDULED").map((item) => ({ ...item, status: "CANCELLED", updatedAt: now }));
    change.memory = this.#memory(detail, { nextAction: null, nextActionAt: null, dealStage: "DO_NOT_CONTACT" });
    change.events?.push(this.#event(businessId, "DO_NOT_CONTACT", { reason }, `${idempotencyKey}:event`));
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated;
  }

  async reconcileCompletedOwnerCall(input: {
    businessId: string;
    callId: string;
    contactId: string;
    idempotencyKey: string;
  }): Promise<SalesBusinessDetail> {
    const detail = await this.#requireBusiness(input.businessId);
    const call = detail.calls.find((item) => item.id === input.callId);
    const contact = detail.contacts.find((item) => item.id === input.contactId);
    if (!call || call.status !== "COMPLETED" || !call.transcript) {
      throw new SalesPolicyViolationError("COMPLETED_CALL_REQUIRED", "A completed call with transcript evidence is required.");
    }
    if (!contact || !contact.isDecisionMaker || !contact.verified) {
      throw new SalesPolicyViolationError("DECISION_MAKER_REQUIRED", "A verified decision maker is required.");
    }
    if (call.contactId === contact.id && detail.business.salesState === "OWNER_CONTACTED") return detail;
    const pathByStart: Partial<Record<SalesState, SalesState[]>> = {
      CALL_PENDING: ["CALLING", "CONTACTED", "OWNER_CONTACTED"],
      FOLLOW_UP_REQUIRED: ["CALL_PENDING", "CALLING", "CONTACTED", "OWNER_CONTACTED"],
      FOLLOW_UP_SCHEDULED: ["CALL_PENDING", "CALLING", "CONTACTED", "OWNER_CONTACTED"],
      CALLBACK_REQUESTED: ["CALL_PENDING", "CALLING", "CONTACTED", "OWNER_CONTACTED"],
    };
    const path = pathByStart[detail.business.salesState];
    if (!path) throw new SalesPolicyViolationError("INVALID_SALES_STATE", "The completed call cannot be reconciled from the current sales state.");
    const now = this.#now();
    const change = this.#statePath(detail, path, "FOUNDER", "Founder reconciled an already completed, transcript-backed Sarvam owner call.", input.idempotencyKey);
    change.calls = [{ ...call, contactId: contact.id, updatedAt: now }];
    change.memory = this.#memory(detail, { lastContactId: contact.id, dealStage: "OWNER_CONTACTED" });
    change.events?.push(this.#event(input.businessId, "OWNER_IDENTIFIED", { callId: call.id, contactId: contact.id, reconciled: true }, `${input.idempotencyKey}:owner`));
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated;
  }

  async recordDealWon(input: WonDealInput): Promise<SalesBusinessDetail> {
    const detail = await this.#requireBusiness(input.businessId);
    if (detail.business.salesState === "DO_NOT_CONTACT") throw new SalesPolicyViolationError("DO_NOT_CONTACT", "This business opted out of contact.");
    if (detail.business.salesState === "DEAL_WON" || detail.business.salesState === "SPEC_GENERATED") return detail;
    const contact = detail.contacts.find((item) => item.id === input.decisionMakerContactId);
    if (!contact || !contact.isDecisionMaker || !contact.verified) throw new SalesPolicyViolationError("DECISION_MAKER_REQUIRED", "A verified decision maker must accept the deal.");
    const call = detail.calls.find((item) => item.id === input.callId && item.contactId === contact.id);
    if (!call) throw new SalesPolicyViolationError("CALL_NOT_FOUND", "The accepted deal must correlate to the decision maker's call.");
    if (!Number.isSafeInteger(input.quotedPrice) || !Number.isSafeInteger(input.agreedPrice) || input.quotedPrice <= 0) throw new TypeError("Quote and agreement must be positive integer amounts.");
    const policy = input.campaign.pricingPolicy;
    const floor = Math.max(policy.minimumPrice, Math.ceil(input.quotedPrice * (1 - policy.maximumDiscountPercent / 100)));
    if (input.quotedPrice > policy.maximumPrice || input.agreedPrice < floor || input.agreedPrice > input.quotedPrice) {
      throw new SalesPolicyViolationError("PRICE_OUTSIDE_POLICY", "The agreed price is outside campaign pricing policy.");
    }
    if (!Array.isArray(input.requirements.pages) || input.requirements.pages.length === 0 || input.requirements.pages.some((page) => !page.trim())) throw new TypeError("Structured requirements need at least one page.");
    const publicBusinessPhone = normalizePhoneToE164(input.publicBusinessPhone);
    const customerEmail = input.customerEmail?.trim().toLowerCase() || null;
    if (customerEmail && (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
      throw new TypeError("Customer delivery email is invalid.");
    }
    const now = this.#now();
    const pathByStart: Partial<Record<SalesState, SalesState[]>> = {
      OWNER_CONTACTED: ["DISCOVERY_CONVERSATION", "REQUIREMENTS_COLLECTING", "NEGOTIATING", "QUOTE_PRESENTED", "DEAL_WON"],
      DISCOVERY_CONVERSATION: ["REQUIREMENTS_COLLECTING", "NEGOTIATING", "QUOTE_PRESENTED", "DEAL_WON"],
      REQUIREMENTS_COLLECTING: ["NEGOTIATING", "QUOTE_PRESENTED", "DEAL_WON"],
      NEGOTIATING: ["QUOTE_PRESENTED", "DEAL_WON"],
      QUOTE_PRESENTED: ["DEAL_WON"],
    };
    const path = pathByStart[detail.business.salesState];
    if (!path) throw new SalesPolicyViolationError("INVALID_SALES_STATE", "The deal cannot be accepted from the current sales state.");
    const specification: SalesProjectSpecification = {
      schemaVersion: 1, businessId: input.businessId,
      business: { name: detail.business.name, category: detail.business.category, city: detail.business.city,
        phone: publicBusinessPhone },
      contact: { id: contact.id, name: contact.name, roles: contact.roles, email: customerEmail },
      requirements: clone(input.requirements), branding: clone(input.branding),
      commercial: { quotedPrice: input.quotedPrice, agreedPrice: input.agreedPrice, currency: policy.currency },
    };
    const projectSpec: SalesProjectSpec = {
      id: randomUUID(), businessId: input.businessId, contactId: contact.id, version: 1,
      specification, status: "READY", idempotencyKey: `${input.idempotencyKey}:spec`,
      createdAt: now, updatedAt: now,
    };
    const change = this.#statePath(detail, [...path, "SPEC_GENERATED"], "VOICE_AGENT", "Verified decision maker accepted the governed quote and approved a project specification.", input.idempotencyKey);
    change.contacts = [{ ...contact, verified: true, updatedAt: now }];
    change.calls = [{ ...call, status: "COMPLETED", outcome: "DEAL_WON", summary: nonEmpty(input.summary, "summary", 4_000), transcript: input.transcript ?? call.transcript, language: input.language ?? call.language, endedAt: now, updatedAt: now }];
    change.memory = this.#memory(detail, {
      summary: input.summary,
      objections: input.objections.map((item) => nonEmpty(item, "objection", 500)),
      requirements: clone(input.requirements), quotedPrice: input.quotedPrice,
      agreedPrice: input.agreedPrice, nextAction: "Generate project specification and start delivery",
      nextActionAt: now, lastContactId: contact.id, dealStage: "DEAL_WON",
    });
    change.projectSpec = projectSpec;
    change.events?.push(
      this.#event(input.businessId, "REQUIREMENT_CAPTURED", { callId: call.id, pages: input.requirements.pages }, `${input.idempotencyKey}:requirements`),
      this.#event(input.businessId, "QUOTE_CREATED", { quotedPrice: input.quotedPrice, agreedPrice: input.agreedPrice, floor }, `${input.idempotencyKey}:quote`),
      this.#event(input.businessId, "DEAL_WON", { contactId: contact.id, agreedPrice: input.agreedPrice }, `${input.idempotencyKey}:won`),
      this.#event(input.businessId, "SPEC_GENERATED", { specId: projectSpec.id }, `${input.idempotencyKey}:spec-event`),
    );
    change.jobs = [this.#job(input.businessId, "TRIGGER_DEVELOPER", { specId: projectSpec.id }, `${input.idempotencyKey}:developer-job`)];
    change.outbox = [
      this.#outbox(input.businessId, "SYNC_REQUIREMENTS", { specId: projectSpec.id }, `${input.idempotencyKey}:crm-requirements`),
      this.#outbox(input.businessId, "SYNC_QUOTE", { quotedPrice: input.quotedPrice, agreedPrice: input.agreedPrice }, `${input.idempotencyKey}:crm-quote`),
      this.#outbox(input.businessId, "SYNC_DEAL_STAGE", { stage: "DEAL_WON" }, `${input.idempotencyKey}:crm-won`),
      this.#outbox(input.businessId, "SYNC_CALL", { callId: call.id }, `${input.idempotencyKey}:crm-call`),
    ];
    const updated = await this.repository.applyChange(change);
    this.#publish(change.events ?? [], updated);
    return updated;
  }

  #statePath(
    detail: SalesBusinessDetail,
    path: SalesState[],
    actor: "SALES_ORCHESTRATOR" | "VOICE_AGENT" | "TELEPHONY" | "FOUNDER",
    reason: string,
    idempotencyKey: string,
  ): SalesChange {
    const transitions: SalesStateTransitionRecord[] = [];
    const events: SalesEvent[] = [];
    let state = detail.business.salesState;
    for (const [index, next] of path.entries()) {
      const transition = this.#stateMachine.transition({
        businessId: detail.business.id, currentState: state, targetState: next, actor,
        reason, idempotencyKey: `${idempotencyKey}:transition:${index + 1}`,
        at: this.#now(),
      }, [...detail.transitions, ...transitions]);
      transitions.push(transition.transition);
      events.push(this.#event(detail.business.id, "SALES_STATE_CHANGED", { from: state, to: next, actor }, `${idempotencyKey}:state-event:${index + 1}`));
      state = next;
    }
    return {
      businessId: detail.business.id,
      ...(path.length ? { expectedState: detail.business.salesState, nextState: state } : {}),
      transitions,
      events,
    };
  }

  #memory(detail: SalesBusinessDetail, patch: Partial<SalesMemory>): SalesMemory {
    const now = this.#now();
    return {
      id: detail.memory?.id ?? randomUUID(), businessId: detail.business.id,
      summary: detail.memory?.summary ?? "", objections: detail.memory?.objections ?? [],
      requirements: detail.memory?.requirements ?? {}, quotedPrice: detail.memory?.quotedPrice ?? null,
      agreedPrice: detail.memory?.agreedPrice ?? null, currency: detail.memory?.currency ?? "INR",
      dealStage: detail.memory?.dealStage ?? detail.business.salesState,
      nextAction: detail.memory?.nextAction ?? null, nextActionAt: detail.memory?.nextActionAt ?? null,
      lastContactId: detail.memory?.lastContactId ?? null,
      createdAt: detail.memory?.createdAt ?? now, updatedAt: now,
      ...patch,
    };
  }

  #event(businessId: string, eventType: SalesEventType, metadata: Record<string, unknown>, idempotencyKey: string): SalesEvent {
    return { id: randomUUID(), businessId, eventType, metadata, correlationId: businessId, idempotencyKey, timestamp: this.#now() };
  }

  #job(businessId: string, type: SalesJob["type"], payload: Record<string, unknown>, dedupeKey: string, availableAt = this.#now()): SalesJob {
    const now = this.#now();
    return { id: randomUUID(), businessId, type, payload, status: "QUEUED", availableAt,
      attempts: 0, maxAttempts: 5, lockedAt: null, lockExpiresAt: null, lockedBy: null,
      lastError: null, dedupeKey, createdAt: now, updatedAt: now };
  }

  #outbox(businessId: string, operation: CRMOutboxOperation, payload: Record<string, unknown>, idempotencyKey: string): CRMOutboxItem {
    const now = this.#now();
    return { id: randomUUID(), businessId, operation, payload, status: "QUEUED", availableAt: now,
      attempts: 0, maxAttempts: 8, lockedAt: null, lockExpiresAt: null, lockedBy: null,
      lastError: null, idempotencyKey, createdAt: now, updatedAt: now };
  }

  #publish(events: readonly SalesEvent[], detail: SalesBusinessDetail): void {
    for (const event of events) {
      const projection: AgentEvent = {
        id: event.id, leadId: null, projectId: null, campaignId: null, agentType: "SALES",
        eventType: `sales.${event.eventType.toLowerCase()}`,
        message: `${detail.business.name}: ${event.eventType.replaceAll("_", " ").toLowerCase()}.`,
        metadata: { ...event.metadata, businessId: event.businessId, salesEventId: event.id },
        status: event.eventType === "CALL_FAILED" ? "ERROR" : "INFO",
        durationMs: null, createdAt: event.timestamp,
      };
      this.events.publish(projection);
    }
  }

  async #requireBusiness(businessId: string): Promise<SalesBusinessDetail> {
    const detail = await this.repository.getDetail(nonEmpty(businessId, "businessId", 128));
    if (!detail) throw new SalesPolicyViolationError("BUSINESS_NOT_FOUND", "Business was not found.");
    return detail;
  }

  #now(): string {
    const date = this.#clock();
    if (!Number.isFinite(date.getTime())) throw new Error("Sales clock returned an invalid date.");
    return date.toISOString();
  }
}
