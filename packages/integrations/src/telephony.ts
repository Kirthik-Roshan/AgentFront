import { createHash, timingSafeEqual } from "node:crypto";

/**
 * This contract intentionally lives in the integrations package until the sales
 * domain has a stable shared telephony contract. It keeps provider details out
 * of the orchestrator while allowing a future real adapter to implement the
 * same fail-closed webhook boundary.
 */
export type TelephonyProviderName = "demo" | "exotel" | "twilio" | "vobiz" | "sarvam";
export type TelephonyMode = "REAL" | "DEMO";
export type TelephonyCallDirection = "INBOUND" | "OUTBOUND";
export type TelephonyCallStatus = "INITIATING" | "RINGING" | "IN_PROGRESS" | "COMPLETED" | "TERMINATED" | "FAILED";

export interface TelephonyHealth {
  integration: "telephony";
  provider: string;
  mode: TelephonyMode;
  status: "CONNECTED" | "DEMO" | "DEGRADED" | "UNAVAILABLE";
  message: string;
  checkedAt: string;
}

export interface OutboundCallRequest {
  businessId: string;
  contactId?: string | null;
  to: string;
  /** Exact destination explicitly confirmed by the authenticated founder. */
  founderApprovedDestination?: string;
  metadata?: Readonly<Record<string, string>>;
  /** Strictly allowlisted, business-specific variables supplied to the committed voice agent. */
  agentVariables?: Readonly<Record<string, string>>;
}

export interface TelephonyCall {
  /** AgentFront-scoped identifier. Never derived from a phone number. */
  id: string;
  providerCallId: string;
  provider: TelephonyProviderName;
  mode: TelephonyMode;
  direction: TelephonyCallDirection;
  businessId: string | null;
  contactId: string | null;
  callerPhone: string | null;
  calleePhone: string;
  status: TelephonyCallStatus;
  startedAt: string;
  endedAt: string | null;
}

export interface TelephonyWebhookRequest {
  /** Exact, unparsed bytes received from the provider. */
  rawBody: string | Uint8Array;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface TelephonyInboundEvent {
  /** AgentFront-scoped event identifier. */
  id: string;
  type: "CALL_INBOUND";
  callId: string;
  providerCallId: string;
  provider: TelephonyProviderName;
  direction: "INBOUND";
  callerPhone: string;
  calledPhone: string;
  occurredAt: string;
}

export interface DemoInboundWebhookPayload {
  event: "call.inbound";
  eventId: string;
  providerCallId: string;
  from: string;
  to: string;
  occurredAt: string;
}

export interface TelephonyProvider {
  readonly name: string;
  /** Null only when TELEPHONY_PROVIDER itself is absent or unsupported. */
  readonly provider: TelephonyProviderName | null;
  readonly mode: TelephonyMode;
  makeOutboundCall(request: OutboundCallRequest, idempotencyKey: string): Promise<TelephonyCall>;
  terminateCall(callId: string): Promise<TelephonyCall>;
  verifyWebhook(request: TelephonyWebhookRequest): Promise<boolean>;
  parseInboundWebhook(request: TelephonyWebhookRequest): Promise<TelephonyInboundEvent>;
  getCallerPhone(event: TelephonyInboundEvent): string;
  health(): Promise<TelephonyHealth>;
}

export interface TelephonyEnvironment {
  TELEPHONY_PROVIDER?: string;
  SARVAM_API_KEY?: string;
  SARVAM_ORG_ID?: string;
  SARVAM_WORKSPACE_ID?: string;
  SARVAM_SALES_APP_ID?: string;
  SARVAM_SALES_APP_VERSION?: string;
  SARVAM_CONNECTION_ID?: string;
  SARVAM_AGENT_PHONE_NUMBER?: string;
  SARVAM_OUTBOUND_WEBHOOK_URL?: string;
  SARVAM_ALLOWED_BUSINESS_ID?: string;
  DEMO_BUSINESS_PHONE?: string;
  SARVAM_ALLOW_DISCOVERED_DESTINATIONS?: string;
}

export interface TelephonyProviderDependencies {
  fetch?: typeof fetch;
  clock?: Clock;
}

const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_METADATA_ENTRIES = 32;
const DEMO_SIGNATURE_HEADER = "x-agentfront-demo-signature";
const PROVIDER_LABELS = {
  demo: "AgentFront Demo Telephony",
  exotel: "Exotel",
  twilio: "Twilio",
  vobiz: "VoBiz",
  sarvam: "Sarvam Voice Agents (Vobiz)",
} as const satisfies Record<TelephonyProviderName, string>;

type Clock = () => Date;
type UnavailableSelection = Exclude<TelephonyProviderName, "demo"> | "unconfigured";

export interface SarvamOutboundConfiguration {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  appId: string;
  appVersion: number;
  connectionId: string;
  agentPhoneNumber: string;
  webhookUrl: string;
  /** Demo safety boundary used unless discovered destinations are explicitly enabled. */
  allowedBusinessId: string;
  /** Explicitly opted-in founder number used by the controlled demo policy. */
  allowedDestination: string;
  /** Allows founder-approved Google Places numbers to be used as the destination. */
  allowDiscoveredDestinations?: boolean;
}

interface SarvamAttemptResponse {
  attempt_id: string;
}

/**
 * Sarvam owns the realtime multilingual agent and uses its configured Vobiz
 * connection for PSTN. Real discovered destinations remain behind an
 * authenticated founder action and the sales policy's calling-window, retry
 * and do-not-contact checks.
 */
export class SarvamVobizTelephonyProvider implements TelephonyProvider {
  readonly name = PROVIDER_LABELS.sarvam;
  readonly provider = "sarvam" as const;
  readonly mode = "REAL" as const;
  readonly #configuration: SarvamOutboundConfiguration;
  readonly #fetch: typeof fetch;
  readonly #clock: Clock;
  readonly #callsByIdempotencyKey = new Map<string, StoredOutboundCall>();

  constructor(configuration: SarvamOutboundConfiguration, dependencies: {
    fetch?: typeof fetch;
    clock?: Clock;
  } = {}) {
    this.#configuration = validateSarvamConfiguration(configuration);
    this.#fetch = dependencies.fetch ?? fetch;
    this.#clock = dependencies.clock ?? (() => new Date());
  }

  async makeOutboundCall(request: OutboundCallRequest, idempotencyKey: string): Promise<TelephonyCall> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const normalized = normalizeOutboundRequest(request);
    if (!this.#configuration.allowDiscoveredDestinations && normalized.businessId !== this.#configuration.allowedBusinessId) {
      throw new Error("Sarvam demo calling is restricted to the configured business.");
    }

    // Demo mode substitutes the opted-in founder number. The discovered-number
    // policy uses the persisted provider phone only after the authenticated
    // founder approval enforced by the sales route.
    const isConfiguredDemoBusiness = normalized.businessId === this.#configuration.allowedBusinessId;
    const destination = isConfiguredDemoBusiness
      ? this.#configuration.allowedDestination
      : normalized.to;
    if (!isConfiguredDemoBusiness && this.#configuration.allowDiscoveredDestinations) {
      const approved = (() => {
        try {
          return request.founderApprovedDestination
            ? normalizePhone(request.founderApprovedDestination, "founderApprovedDestination")
            : null;
        } catch { return null; }
      })();
      if (!approved || approved !== destination) {
        throw new Error("Exact founder approval is required for the discovered call destination.");
      }
    }
    const fingerprint = digest(stableStringify({ ...normalized, to: destination }));
    const replay = this.#callsByIdempotencyKey.get(key);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new Error("The telephony idempotency key was already used for a different Sarvam call.");
      }
      return structuredClone(replay.call);
    }

    // Never dial when Sarvam would be unable to return the authoritative
    // transcript and post-call variables. Configuration alone is not proof
    // that a temporary tunnel (or deployed callback) is still reachable.
    await this.#verifyPublicCallback();

    const metadata = {
      ...normalized.metadata,
      business_id: normalized.businessId,
      ...(normalized.contactId ? { contact_id: normalized.contactId } : {}),
      idempotency_hash: digest(key).slice(0, 32),
    };
    const endpoint = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${encodeURIComponent(this.#configuration.orgId)}` +
      `/workspaces/${encodeURIComponent(this.#configuration.workspaceId)}/outbounds`;
    const response = await this.#fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.#configuration.apiKey,
      },
      body: JSON.stringify({
        app_config: {
          app_id: this.#configuration.appId,
          app_version: this.#configuration.appVersion,
          agent_variables: normalized.agentVariables,
          app_type: "agent",
          connection_config: {
            connection_id: this.#configuration.connectionId,
            agent_phone_number: this.#configuration.agentPhoneNumber,
          },
        },
        user_config: { user_phone_number: destination },
        webhook_config: { url: this.#configuration.webhookUrl, metadata },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Sarvam outbound call request failed (${response.status}): ${boundedProviderError(body)}`);
    }
    const payload = parseAttemptResponse(body);
    const startedAt = nowIso(this.#clock);
    const call: TelephonyCall = {
      id: `tel_call_sarvam_${digest(payload.attempt_id).slice(0, 24)}`,
      providerCallId: payload.attempt_id,
      provider: this.provider,
      mode: this.mode,
      direction: "OUTBOUND",
      businessId: normalized.businessId,
      contactId: normalized.contactId,
      callerPhone: this.#configuration.agentPhoneNumber,
      calleePhone: destination,
      // Instant Outbound only confirms that Sarvam accepted the request. It does not prove that Vobiz has started ringing the destination.
      status: "INITIATING",
      startedAt,
      endedAt: null,
    };
    this.#callsByIdempotencyKey.set(key, { fingerprint, call });
    return structuredClone(call);
  }

  async terminateCall(_callId: string): Promise<TelephonyCall> {
    throw new Error("Sarvam Instant Outbound does not document a call-termination endpoint.");
  }

  async verifyWebhook(_request: TelephonyWebhookRequest): Promise<boolean> {
    throw new Error("Sarvam outbound completion uses the dedicated correlated webhook route.");
  }

  async parseInboundWebhook(_request: TelephonyWebhookRequest): Promise<TelephonyInboundEvent> {
    throw new Error("Inbound calling is not enabled by the Sarvam outbound adapter.");
  }

  getCallerPhone(_event: TelephonyInboundEvent): string {
    throw new Error("Inbound calling is not enabled by the Sarvam outbound adapter.");
  }

  async health(): Promise<TelephonyHealth> {
    try {
      await this.#verifyPublicCallback();
    } catch {
      return {
        integration: "telephony",
        provider: this.name,
        mode: this.mode,
        status: "DEGRADED",
        message: "Sarvam is configured, but the public AgentFront webhook is unreachable. Start or refresh the HTTPS tunnel before calling.",
        checkedAt: nowIso(this.#clock),
      };
    }
    return {
      integration: "telephony",
      provider: this.name,
      mode: this.mode,
      status: "CONNECTED",
      message: this.#configuration.allowDiscoveredDestinations
        ? "Sarvam Instant Outbound is ready for founder-approved discovered business calls."
        : "Sarvam Instant Outbound and its public AgentFront callback are reachable for the consented SpiceRoute demo.",
      checkedAt: nowIso(this.#clock),
    };
  }

  async #verifyPublicCallback(): Promise<void> {
    const healthUrl = new URL(this.#configuration.webhookUrl);
    healthUrl.pathname = "/api/health";
    healthUrl.search = "";
    healthUrl.hash = "";
    let response: Response;
    try {
      response = await this.#fetch(healthUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new Error("The public AgentFront webhook is unreachable.");
    }
    if (!response.ok) throw new Error("The public AgentFront webhook health check failed.");
    const source = await response.text();
    if (Buffer.byteLength(source) > 8_192) throw new Error("The public AgentFront health response is invalid.");
    let payload: unknown;
    try {
      payload = JSON.parse(source) as unknown;
    } catch {
      throw new Error("The public AgentFront health response is invalid.");
    }
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? record.data as Record<string, unknown> : null;
    if (record?.ok !== true || data?.service !== "agentfront-api" || data.status !== "ok") {
      throw new Error("The public callback does not resolve to AgentFront.");
    }
  }
}

interface StoredOutboundCall {
  fingerprint: string;
  call: TelephonyCall;
}

interface StoredInboundEvent {
  fingerprint: string;
  event: TelephonyInboundEvent;
}

export class TelephonyUnavailableError extends Error {
  readonly code = "TELEPHONY_UNAVAILABLE";

  constructor(
    readonly selectedProvider: UnavailableSelection,
    message: string,
  ) {
    super(message);
    this.name = "TelephonyUnavailableError";
  }
}

/**
 * A deterministic simulator. Its webhook checksum is deliberately not an
 * authentication secret; it protects the demo boundary from accidental body
 * mutation only. Real adapters must verify their provider's authenticated
 * signature against the exact raw body.
 */
export class DemoTelephonyProvider implements TelephonyProvider {
  readonly name = PROVIDER_LABELS.demo;
  readonly provider = "demo" as const;
  readonly mode = "DEMO" as const;
  readonly #callsByIdempotencyKey = new Map<string, StoredOutboundCall>();
  readonly #callsById = new Map<string, TelephonyCall>();
  readonly #inboundEventsByProviderId = new Map<string, StoredInboundEvent>();

  constructor(private readonly clock: Clock = () => new Date()) {}

  async makeOutboundCall(request: OutboundCallRequest, idempotencyKey: string): Promise<TelephonyCall> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const normalizedRequest = normalizeOutboundRequest(request);
    const fingerprint = digest(stableStringify(normalizedRequest));
    const replay = this.#callsByIdempotencyKey.get(key);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new Error("The telephony idempotency key was already used for a different outbound call.");
      }
      return structuredClone(replay.call);
    }

    const token = digest(`outbound:${key}`).slice(0, 24);
    const call: TelephonyCall = {
      id: `tel_call_demo_${token}`,
      providerCallId: `demo_call_${token}`,
      provider: this.provider,
      mode: this.mode,
      direction: "OUTBOUND",
      businessId: normalizedRequest.businessId,
      contactId: normalizedRequest.contactId,
      callerPhone: null,
      calleePhone: normalizedRequest.to,
      status: "RINGING",
      startedAt: nowIso(this.clock),
      endedAt: null,
    };
    this.#callsByIdempotencyKey.set(key, { fingerprint, call });
    this.#callsById.set(call.id, call);
    return structuredClone(call);
  }

  async terminateCall(callId: string): Promise<TelephonyCall> {
    const call = this.#callsById.get(callId);
    if (!call) throw new Error("The demo telephony call was not found.");
    if (call.status !== "TERMINATED") {
      call.status = "TERMINATED";
      call.endedAt = nowIso(this.clock);
    }
    return structuredClone(call);
  }

  async verifyWebhook(request: TelephonyWebhookRequest): Promise<boolean> {
    let rawBody: Uint8Array;
    try {
      rawBody = getRawBody(request.rawBody);
    } catch {
      return false;
    }
    if (!isJsonContentType(getHeader(request.headers, "content-type"))) return false;
    const supplied = getHeader(request.headers, DEMO_SIGNATURE_HEADER);
    if (!supplied || !/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;
    const expected = createDemoWebhookSignature(rawBody);
    return safeEqual(supplied, expected);
  }

  async parseInboundWebhook(request: TelephonyWebhookRequest): Promise<TelephonyInboundEvent> {
    if (!(await this.verifyWebhook(request))) {
      throw new Error("Demo telephony webhook verification failed.");
    }
    const rawBody = getRawBody(request.rawBody);
    const payload = parseJsonObject(rawBody);
    if (payload.event !== "call.inbound") throw new Error("Unsupported demo telephony webhook event.");

    const eventId = normalizeProviderToken(payload.eventId, "eventId");
    const providerCallId = normalizeProviderToken(payload.providerCallId, "providerCallId");
    const callerPhone = normalizePhone(payload.from, "from");
    const calledPhone = normalizePhone(payload.to, "to");
    const occurredAt = normalizeIsoTimestamp(payload.occurredAt);
    const fingerprint = digest(stableStringify({ providerCallId, callerPhone, calledPhone, occurredAt }));
    const replay = this.#inboundEventsByProviderId.get(eventId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new Error("The demo telephony event ID was already used for a different webhook.");
      }
      return structuredClone(replay.event);
    }

    const event: TelephonyInboundEvent = {
      id: `tel_event_demo_${digest(`event:${eventId}`).slice(0, 24)}`,
      type: "CALL_INBOUND",
      callId: `tel_call_demo_${digest(`inbound:${providerCallId}`).slice(0, 24)}`,
      providerCallId,
      provider: this.provider,
      direction: "INBOUND",
      callerPhone,
      calledPhone,
      occurredAt,
    };
    this.#inboundEventsByProviderId.set(eventId, { fingerprint, event });
    return structuredClone(event);
  }

  getCallerPhone(event: TelephonyInboundEvent): string {
    if (event.provider !== this.provider || event.direction !== "INBOUND") {
      throw new Error("The inbound event does not belong to the demo telephony provider.");
    }
    return normalizePhone(event.callerPhone, "callerPhone");
  }

  async health(): Promise<TelephonyHealth> {
    return {
      integration: "telephony",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: "SIMULATED TELEPHONY is active; no real phone call will be placed.",
      checkedAt: nowIso(this.clock),
    };
  }
}

/** A fail-closed placeholder for selected providers that have no usable adapter. */
export class UnavailableTelephonyProvider implements TelephonyProvider {
  readonly name: string;
  readonly provider: Exclude<TelephonyProviderName, "demo"> | null;
  readonly mode = "REAL" as const;

  constructor(
    readonly selectedProvider: UnavailableSelection,
    private readonly reason = defaultUnavailableReason(selectedProvider),
    private readonly clock: Clock = () => new Date(),
  ) {
    this.provider = selectedProvider === "unconfigured" ? null : selectedProvider;
    this.name = selectedProvider === "unconfigured" ? "Telephony (not configured)" : PROVIDER_LABELS[selectedProvider];
  }

  async makeOutboundCall(_request: OutboundCallRequest, _idempotencyKey: string): Promise<TelephonyCall> {
    throw this.#error();
  }

  async terminateCall(_callId: string): Promise<TelephonyCall> {
    throw this.#error();
  }

  async verifyWebhook(_request: TelephonyWebhookRequest): Promise<boolean> {
    throw this.#error();
  }

  async parseInboundWebhook(_request: TelephonyWebhookRequest): Promise<TelephonyInboundEvent> {
    throw this.#error();
  }

  getCallerPhone(_event: TelephonyInboundEvent): string {
    throw this.#error();
  }

  async health(): Promise<TelephonyHealth> {
    return {
      integration: "telephony",
      provider: this.name,
      mode: this.mode,
      status: "UNAVAILABLE",
      message: this.reason,
      checkedAt: nowIso(this.clock),
    };
  }

  #error(): TelephonyUnavailableError {
    return new TelephonyUnavailableError(this.selectedProvider, this.reason);
  }
}

/**
 * Selects telephony explicitly. Missing/unknown configuration fails closed, and
 * real-provider names remain unavailable until a real adapter is installed.
 */
export function createTelephonyProvider(
  environment: TelephonyEnvironment,
  dependencies: TelephonyProviderDependencies = {},
): TelephonyProvider {
  const selected = environment.TELEPHONY_PROVIDER?.trim().toLowerCase();
  if (selected === "demo") return new DemoTelephonyProvider(dependencies.clock);
  if (selected === "sarvam") {
    try {
      return new SarvamVobizTelephonyProvider(sarvamConfigurationFromEnvironment(environment), dependencies);
    } catch (error) {
      return new UnavailableTelephonyProvider(
        "sarvam",
        error instanceof Error ? error.message : "Sarvam telephony configuration is invalid.",
        dependencies.clock,
      );
    }
  }
  if (selected === "exotel" || selected === "twilio" || selected === "vobiz") {
    return new UnavailableTelephonyProvider(selected, undefined, dependencies.clock);
  }
  const reason = selected
    ? "TELEPHONY_PROVIDER is unsupported; allowed values are demo, sarvam, exotel, twilio, and vobiz."
    : "TELEPHONY_PROVIDER is not configured; outbound calls and inbound webhooks are disabled.";
  return new UnavailableTelephonyProvider("unconfigured", reason, dependencies.clock);
}

export function sarvamConfigurationFromEnvironment(environment: TelephonyEnvironment): SarvamOutboundConfiguration {
  const required = (name: keyof TelephonyEnvironment): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name} is required when TELEPHONY_PROVIDER=sarvam.`);
    return value;
  };
  const versionText = required("SARVAM_SALES_APP_VERSION");
  const appVersion = Number(versionText);
  if (!Number.isSafeInteger(appVersion) || appVersion < 1) {
    throw new Error("SARVAM_SALES_APP_VERSION must be a positive integer.");
  }
  return validateSarvamConfiguration({
    apiKey: required("SARVAM_API_KEY"),
    orgId: required("SARVAM_ORG_ID"),
    workspaceId: required("SARVAM_WORKSPACE_ID"),
    appId: required("SARVAM_SALES_APP_ID"),
    appVersion,
    connectionId: required("SARVAM_CONNECTION_ID"),
    agentPhoneNumber: required("SARVAM_AGENT_PHONE_NUMBER"),
    webhookUrl: required("SARVAM_OUTBOUND_WEBHOOK_URL"),
    allowedBusinessId: required("SARVAM_ALLOWED_BUSINESS_ID"),
    allowedDestination: required("DEMO_BUSINESS_PHONE"),
    allowDiscoveredDestinations: environment.SARVAM_ALLOW_DISCOVERED_DESTINATIONS?.trim().toLowerCase() === "true",
  });
}

/** Creates the non-secret integrity checksum accepted only by the demo adapter. */
export function createDemoWebhookSignature(rawBody: string | Uint8Array): string {
  return `sha256=${digest(getRawBody(rawBody))}`;
}

function defaultUnavailableReason(provider: UnavailableSelection): string {
  if (provider === "unconfigured") {
    return "TELEPHONY_PROVIDER is not configured; outbound calls and inbound webhooks are disabled.";
  }
  return `${PROVIDER_LABELS[provider]} telephony is unavailable because no authenticated real adapter is installed.`;
}

function validateSarvamConfiguration(configuration: SarvamOutboundConfiguration): SarvamOutboundConfiguration {
  const token = (value: string, label: string, maximum = 256): string => {
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum || /[\r\n]/.test(normalized)) {
      throw new Error(`${label} is missing or invalid.`);
    }
    return normalized;
  };
  const webhook = token(configuration.webhookUrl, "SARVAM_OUTBOUND_WEBHOOK_URL", 2_048);
  let parsedWebhook: URL;
  try {
    parsedWebhook = new URL(webhook);
  } catch {
    throw new Error("SARVAM_OUTBOUND_WEBHOOK_URL must be a valid absolute URL.");
  }
  if (parsedWebhook.protocol !== "https:") {
    throw new Error("SARVAM_OUTBOUND_WEBHOOK_URL must use HTTPS.");
  }
  if (!Number.isSafeInteger(configuration.appVersion) || configuration.appVersion < 1) {
    throw new Error("SARVAM_SALES_APP_VERSION must be a positive integer.");
  }
  const allowedDestination = normalizePhone(configuration.allowedDestination, "DEMO_BUSINESS_PHONE");
  return {
    apiKey: token(configuration.apiKey, "SARVAM_API_KEY", 1_000),
    orgId: token(configuration.orgId, "SARVAM_ORG_ID"),
    workspaceId: token(configuration.workspaceId, "SARVAM_WORKSPACE_ID"),
    appId: token(configuration.appId, "SARVAM_SALES_APP_ID"),
    appVersion: configuration.appVersion,
    connectionId: token(configuration.connectionId, "SARVAM_CONNECTION_ID"),
    agentPhoneNumber: normalizePhone(configuration.agentPhoneNumber, "SARVAM_AGENT_PHONE_NUMBER"),
    webhookUrl: parsedWebhook.toString(),
    allowedBusinessId: normalizeDomainId(configuration.allowedBusinessId, "SARVAM_ALLOWED_BUSINESS_ID"),
    allowedDestination,
    allowDiscoveredDestinations: configuration.allowDiscoveredDestinations === true,
  };
}

function parseAttemptResponse(body: string): SarvamAttemptResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("Sarvam returned a non-JSON outbound response.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Sarvam returned an invalid outbound response.");
  }
  const attemptId = (parsed as Record<string, unknown>).attempt_id;
  if (typeof attemptId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(attemptId)) {
    throw new Error("Sarvam outbound response is missing a valid attempt_id.");
  }
  return { attempt_id: attemptId };
}

function boundedProviderError(body: string): string {
  // Provider errors can echo input; never expose phone numbers or credentials.
  return body.replace(/\+\d{8,15}/g, "[REDACTED_PHONE]").replace(/\s+/g, " ").trim().slice(0, 500) || "No response detail.";
}

function getRawBody(rawBody: string | Uint8Array): Uint8Array {
  const bytes = typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : rawBody;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_WEBHOOK_BYTES) {
    throw new Error("Telephony webhook body must contain between 1 and 65536 bytes.");
  }
  return bytes;
}

function parseJsonObject(rawBody: Uint8Array): Record<string, unknown> {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    throw new Error("Telephony webhook body is not valid UTF-8.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    throw new Error("Telephony webhook body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Telephony webhook body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function normalizeOutboundRequest(request: OutboundCallRequest): Required<Omit<OutboundCallRequest, "metadata" | "agentVariables" | "founderApprovedDestination">> & {
  metadata: Record<string, string>;
  agentVariables: Record<string, string>;
} {
  const businessId = normalizeDomainId(request.businessId, "businessId");
  const contactId = request.contactId == null ? null : normalizeDomainId(request.contactId, "contactId");
  const to = normalizePhone(request.to, "to");
  const metadataEntries = Object.entries(request.metadata ?? {});
  if (metadataEntries.length > MAX_METADATA_ENTRIES) throw new Error("Telephony metadata has too many entries.");
  const metadata: Record<string, string> = {};
  for (const [key, value] of metadataEntries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || typeof value !== "string" || value.length > 512) {
      throw new Error("Telephony metadata contains an invalid key or value.");
    }
    metadata[key] = value;
  }
  const variableEntries = Object.entries(request.agentVariables ?? {});
  if (variableEntries.length > 20) throw new Error("Sarvam agent variables have too many entries.");
  const agentVariables: Record<string, string> = {};
  for (const [key, value] of variableEntries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof value !== "string" || !value.trim() || value.length > 500) {
      throw new Error("Sarvam agent variables contain an invalid key or value.");
    }
    agentVariables[key] = value.trim();
  }
  return { businessId, contactId, to, metadata, agentVariables };
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new Error("A non-empty telephony idempotency key of at most 256 characters is required.");
  }
  return normalized;
}

function normalizeDomainId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Telephony ${label} is invalid.`);
  }
  return value;
}

function normalizeProviderToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`Telephony webhook ${label} is invalid.`);
  }
  return value;
}

function normalizePhone(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Telephony ${label} must be an E.164 phone number.`);
  const normalized = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error(`Telephony ${label} must be an E.164 phone number.`);
  }
  return normalized;
}

function normalizeIsoTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) throw new Error("Telephony webhook occurredAt is invalid.");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Telephony webhook occurredAt is invalid.");
  return new Date(milliseconds).toISOString();
}

function nowIso(clock: Clock): string {
  const date = clock();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error("Telephony clock returned an invalid date.");
  return date.toISOString();
}

function getHeader(
  headers: TelephonyWebhookRequest["headers"],
  requestedName: string,
): string | null {
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === requestedName);
  if (!match || Array.isArray(match[1]) || typeof match[1] !== "string") return null;
  return match[1].trim();
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
