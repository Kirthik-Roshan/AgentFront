import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { calculateOpportunityScore } from "@agentfront/scoring";
import {
  buildElevenLabsDynamicVariables,
  createDodoTestCheckout,
  dodoTestConfigFromEnv,
  verifyDodoTestWebhook,
} from "@agentfront/integrations";
import { resolveBusinessVertical } from "@agentfront/types";
import type {
  ApiResponse,
  BusinessType,
  CampaignStatus,
  ConversationOutcome,
  IntegrationHealth,
  LeadAggregate,
  PipelineState,
  PlacesSearchRequest,
  ProjectFeature,
} from "@agentfront/types";
import type { ApiRuntime } from "./runtime";
import { handleDodoTestRoute, type DodoTestRoutes } from "./dodo-routes";
import { handleSalesRoute } from "./sales-routes";
import { handleSarvamOutboundWebhook } from "./sarvam-routes";
import { handleVoiceToolRoute } from "./voice-tools";
import { FounderSessionAuth } from "./session-auth";

const businessTypes = new Set<BusinessType>(["restaurant", "salon", "garments", "mechanic", "clinic", "education", "realestate", "fitness", "bakery", "legal"]);
const projectFeatures = new Set<ProjectFeature>([
  "menu",
  "gallery",
  "whatsappOrdering",
  "googleMaps",
  "reservations",
  "booking",
  "testimonials",
  "catalog",
  "emergencyContact",
]);
const sentiments = new Set(["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"] as const);
const transcriptSpeakers = new Set(["AGENT", "CUSTOMER", "SYSTEM"] as const);
const currencies = new Set(["INR", "USD"] as const);
const websitePresences = new Set<NonNullable<PlacesSearchRequest["websitePresence"]>>(["ANY", "MISSING", "PRESENT"]);
const routeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface RouterOptions {
  environment?: NodeJS.ProcessEnv;
  bindHost?: string;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const sendJson = <T>(response: ServerResponse, statusCode: number, body: ApiResponse<T>): void => {
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  response.end(json);
};

const readJson = async <T>(request: IncomingMessage): Promise<T> => {
  let body = "";
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(body) > 256_000) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  if (!body) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is required.`);
  }
  return value.trim();
};

const requireBoundedString = (value: unknown, field: string, maximumLength: number): string => {
  const result = requireString(value, field);
  if (result.length > maximumLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be at most ${maximumLength} characters.`);
  }
  return result;
};

const requireRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const assertAllowedKeys = (record: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void => {
  const unsupported = Object.keys(record).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} contains unsupported field${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}.`,
    );
  }
};

const requireEnum = <T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T => {
  const result = requireString(value, field) as T;
  if (!allowed.has(result)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} contains an unsupported value.`);
  }
  return result;
};

const requireInteger = (
  value: unknown,
  field: string,
  options: { minimum?: number; maximum?: number } = {},
): number => {
  if (!Number.isSafeInteger(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a safe integer.`);
  }
  const result = value as number;
  if (options.minimum !== undefined && result < options.minimum) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be at least ${options.minimum}.`);
  }
  if (options.maximum !== undefined && result > options.maximum) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be at most ${options.maximum}.`);
  }
  return result;
};

const requireIsoDate = (value: unknown, field: string): string => {
  const result = requireBoundedString(value, field, 40);
  const timestamp = Date.parse(result);
  if (!isoDatePattern.test(result) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== result) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be an ISO-8601 UTC timestamp.`);
  }
  return result;
};

const requireStringArray = (
  value: unknown,
  field: string,
  options: { minimumItems?: number; maximumItems: number; maximumItemLength: number },
): string[] => {
  if (!Array.isArray(value)) throw new HttpError(400, "VALIDATION_ERROR", `${field} must be an array.`);
  if (value.length < (options.minimumItems ?? 0) || value.length > options.maximumItems) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must contain between ${options.minimumItems ?? 0} and ${options.maximumItems} items.`,
    );
  }
  const result = value.map((item, index) =>
    requireBoundedString(item, `${field}[${index}]`, options.maximumItemLength),
  );
  if (new Set(result).size !== result.length) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must not contain duplicate values.`);
  }
  return result;
};

const validateConversationOutcome = (value: unknown): ConversationOutcome => {
  const outcome = requireRecord(value, "outcome");
  assertAllowedKeys(
    outcome,
    new Set(["transcript", "summary", "sentiment", "requirements", "acceptedAmount"]),
    "outcome",
  );

  if (!Array.isArray(outcome.transcript) || outcome.transcript.length < 1 || outcome.transcript.length > 1_000) {
    throw new HttpError(400, "VALIDATION_ERROR", "outcome.transcript must contain between 1 and 1000 turns.");
  }
  const transcript: ConversationOutcome["transcript"] = outcome.transcript.map((value, index) => {
    const turn = requireRecord(value, `outcome.transcript[${index}]`);
    assertAllowedKeys(turn, new Set(["id", "speaker", "text", "at"]), `outcome.transcript[${index}]`);
    return {
      id: requireBoundedString(turn.id, `outcome.transcript[${index}].id`, 128),
      speaker: requireEnum(turn.speaker, `outcome.transcript[${index}].speaker`, transcriptSpeakers),
      text: requireBoundedString(turn.text, `outcome.transcript[${index}].text`, 20_000),
      at: requireIsoDate(turn.at, `outcome.transcript[${index}].at`),
    };
  });
  if (new Set(transcript.map((turn) => turn.id)).size !== transcript.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "outcome.transcript turn IDs must be unique.");
  }

  const requirementsInput = requireRecord(outcome.requirements, "outcome.requirements");
  assertAllowedKeys(
    requirementsInput,
    new Set([
      "businessType",
      "pages",
      "features",
      "branding",
      "contentRequirements",
      "budget",
      "notes",
      "approvedAt",
    ]),
    "outcome.requirements",
  );

  const featureInput = requireRecord(requirementsInput.features, "outcome.requirements.features");
  assertAllowedKeys(featureInput, projectFeatures, "outcome.requirements.features");
  const features: Partial<Record<ProjectFeature, boolean>> = {};
  for (const [feature, enabled] of Object.entries(featureInput)) {
    if (typeof enabled !== "boolean") {
      throw new HttpError(400, "VALIDATION_ERROR", `outcome.requirements.features.${feature} must be boolean.`);
    }
    features[feature as ProjectFeature] = enabled;
  }

  const brandingInput = requireRecord(requirementsInput.branding, "outcome.requirements.branding");
  assertAllowedKeys(
    brandingInput,
    new Set(["style", "primaryColour", "mobileFirst"]),
    "outcome.requirements.branding",
  );
  const primaryColour = brandingInput.primaryColour;
  if (primaryColour !== null && typeof primaryColour !== "string") {
    throw new HttpError(400, "VALIDATION_ERROR", "outcome.requirements.branding.primaryColour must be a string or null.");
  }
  if (typeof primaryColour === "string" && primaryColour.trim().length > 100) {
    throw new HttpError(400, "VALIDATION_ERROR", "outcome.requirements.branding.primaryColour is too long.");
  }
  if (brandingInput.mobileFirst !== true) {
    throw new HttpError(400, "VALIDATION_ERROR", "outcome.requirements.branding.mobileFirst must be true.");
  }

  const budgetInput = requireRecord(requirementsInput.budget, "outcome.requirements.budget");
  assertAllowedKeys(budgetInput, new Set(["minimum", "maximum", "currency"]), "outcome.requirements.budget");
  const budgetMinimum = requireInteger(budgetInput.minimum, "outcome.requirements.budget.minimum", { minimum: 0 });
  const budgetMaximum = requireInteger(budgetInput.maximum, "outcome.requirements.budget.maximum", { minimum: 1 });
  if (budgetMaximum < budgetMinimum) {
    throw new HttpError(400, "VALIDATION_ERROR", "outcome.requirements.budget.maximum must not be below minimum.");
  }

  const acceptedAmount = outcome.acceptedAmount === null
    ? null
    : requireInteger(outcome.acceptedAmount, "outcome.acceptedAmount", { minimum: 1 });
  const requirements: ConversationOutcome["requirements"] = {
    businessType: requireEnum(requirementsInput.businessType, "outcome.requirements.businessType", businessTypes),
    pages: requireStringArray(requirementsInput.pages, "outcome.requirements.pages", {
      minimumItems: 1,
      maximumItems: 30,
      maximumItemLength: 100,
    }),
    features,
    branding: {
      style: requireBoundedString(brandingInput.style, "outcome.requirements.branding.style", 200),
      primaryColour: typeof primaryColour === "string" ? primaryColour.trim() : null,
      mobileFirst: true,
    },
    contentRequirements: requireStringArray(
      requirementsInput.contentRequirements,
      "outcome.requirements.contentRequirements",
      { maximumItems: 100, maximumItemLength: 1_000 },
    ),
    budget: {
      minimum: budgetMinimum,
      maximum: budgetMaximum,
      currency: requireEnum(budgetInput.currency, "outcome.requirements.budget.currency", currencies),
    },
    notes: requireStringArray(requirementsInput.notes, "outcome.requirements.notes", {
      maximumItems: 100,
      maximumItemLength: 1_000,
    }),
    approvedAt: requireIsoDate(requirementsInput.approvedAt, "outcome.requirements.approvedAt"),
  };

  return {
    transcript,
    summary: requireBoundedString(outcome.summary, "outcome.summary", 20_000),
    sentiment: requireEnum(outcome.sentiment, "outcome.sentiment", sentiments),
    requirements,
    acceptedAmount,
  };
};

const decodeRouteIdentifier = (encoded: string, field: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is not valid URL encoding.`);
  }
  if (!routeIdentifierPattern.test(decoded)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} contains unsupported characters.`);
  }
  return decoded;
};

const isLoopbackHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "::ffff:127.0.0.1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
};

const tokensMatch = (provided: string, expected: string): boolean => {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

const bearerToken = (request: IncomingMessage): string | null => {
  const authorization = request.headers.authorization;
  const match = typeof authorization === "string" ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
  return match?.[1] ?? null;
};

const authorizeRequest = (
  request: IncomingMessage,
  configuredToken: string | null,
  sessionAuth: FounderSessionAuth | null,
  authenticationRequired: boolean,
): void => {
  if (!authenticationRequired) return;
  if (!configuredToken || !sessionAuth) {
    throw new HttpError(
      503,
      "AUTH_NOT_CONFIGURED",
      "AGENTFRONT_API_TOKEN is required for this API deployment.",
    );
  }
  const providedToken = bearerToken(request);
  const cookieHeader = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
  if ((!providedToken || !tokensMatch(providedToken, configuredToken)) && !sessionAuth.validates(cookieHeader)) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "A valid AgentFront founder session or Bearer token is required.",
      { "WWW-Authenticate": 'Bearer realm="AgentFront API"' },
    );
  }
};

const authorizeConversationTool = (request: IncomingMessage, configuredToken: string | null): void => {
  if (!configuredToken) {
    throw new HttpError(
      503,
      "CONVERSATION_TOOL_NOT_CONFIGURED",
      "ELEVENLABS_TOOL_SECRET is required before real conversation completion can be accepted.",
    );
  }
  const providedToken = bearerToken(request);
  if (!providedToken || !tokensMatch(providedToken, configuredToken)) {
    throw new HttpError(
      401,
      "UNAUTHORIZED_CONVERSATION_TOOL",
      "A valid ElevenLabs tool Bearer token is required.",
      { "WWW-Authenticate": 'Bearer realm="AgentFront ElevenLabs tool"' },
    );
  }
};

const publicAggregate = (aggregate: LeadAggregate): LeadAggregate => ({
  ...aggregate,
  conversation: aggregate.conversation
    ? { ...aggregate.conversation, clientToken: null, providerUrl: null }
    : null,
});

const routeId = (pathname: string, prefix: string, suffix = ""): string | null => {
  if (!pathname.startsWith(prefix) || (suffix && !pathname.endsWith(suffix))) return null;
  const end = suffix ? -suffix.length : undefined;
  const encoded = pathname.slice(prefix.length, end);
  return encoded && !encoded.includes("/") ? decodeRouteIdentifier(encoded, "route identifier") : null;
};

const funnelOrder: PipelineState[] = [
  "DISCOVERED",
  "QUALIFIED",
  "CRM_CREATED",
  "CONVERSATION_ACTIVE",
  "REQUIREMENTS_COLLECTED",
  "NEGOTIATING",
  "DEAL_WON",
  "BUILDING",
  "QA",
  "DEPLOYED",
];

export function createRouter(runtime: ApiRuntime, options: RouterOptions = {}) {
  const environment = options.environment ?? process.env;
  const bindHost = options.bindHost?.trim() || environment.HOST?.trim() || "127.0.0.1";
  const configuredToken = environment.AGENTFRONT_API_TOKEN?.trim() || null;
  const configuredConversationToolSecret = environment.ELEVENLABS_TOOL_SECRET?.trim() || null;
  const production = environment.NODE_ENV?.trim().toLowerCase() === "production";
  if (production && configuredToken && configuredToken.length < 32) {
    throw new Error("AGENTFRONT_API_TOKEN must contain at least 32 characters in production.");
  }
  const configuredSessionSecret = environment.AGENTFRONT_SESSION_SECRET?.trim();
  if (production && configuredSessionSecret && configuredSessionSecret.length < 32) {
    throw new Error("AGENTFRONT_SESSION_SECRET must contain at least 32 characters in production.");
  }
  const explicitLoopbackDemo = environment.ALLOW_UNAUTHENTICATED_LOOPBACK_DEMO?.trim().toLowerCase() === "true";
  // An explicit loopback-only demo can open directly with no founder-login
  // page. Non-loopback/public deployments remain protected; removing a UI
  // screen must not publish control APIs.
  const explicitLoopbackBypass = isLoopbackHost(bindHost) && explicitLoopbackDemo;
  const authenticationRequired = !explicitLoopbackBypass &&
    (Boolean(configuredToken) || !isLoopbackHost(bindHost) || production);
  const configuredOrigin = environment.WEB_ORIGIN?.trim() || "http://localhost:3000";
  const parsedOrigin = new URL(configuredOrigin);
  if (!new Set(["http:", "https:"]).has(parsedOrigin.protocol) ||
      parsedOrigin.origin !== configuredOrigin.replace(/\/$/, "")) {
    throw new Error("WEB_ORIGIN must be an exact HTTP(S) origin without a path, query or fragment.");
  }
  const origin = parsedOrigin.origin;
  const sessionAuth = configuredToken
    ? new FounderSessionAuth({
        apiToken: configuredToken,
        sessionSecret: configuredSessionSecret,
        secureCookie: production || origin.startsWith("https://"),
      })
    : null;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const healthTtlMs = Math.max(1_000, Number(environment.AGENTFRONT_HEALTH_TTL_MS ?? 30_000) || 30_000);
  const currentSpiceRoutePaymentProjectId = async (): Promise<string> => {
    const aggregates = await runtime.store.list();
    const current = aggregates
      .filter((aggregate) =>
        aggregate.lead.businessId === "business-spiceroute" &&
        aggregate.lead.campaignId.startsWith("sales-spec-"))
      .sort((left, right) => right.lead.updatedAt.localeCompare(left.lead.updatedAt))[0];
    return current?.lead.projectId ?? "AF-2026-000001";
  };
  const dodoTestRoutes: DodoTestRoutes = {
    createCheckoutOnce: async (idempotencyKey, customer) => {
      const repository = runtime.dodoTestRepository;
      if (!repository) {
        throw Object.assign(new Error("PostgreSQL persistence is required for test checkout."), { code: "PAYMENTS_UNAVAILABLE" });
      }
      const configuration = dodoTestConfigFromEnv(environment, await currentSpiceRoutePaymentProjectId());
      const reservation = await repository.reserveCheckoutOnce(idempotencyKey, customer, configuration);
      if (reservation.kind === "ready") return reservation.session;
      if (reservation.kind === "in_progress") {
        throw Object.assign(new Error("This checkout is still being created. Retry with the same idempotency key."), { code: "CHECKOUT_IN_PROGRESS" });
      }
      try {
        const session = await createDodoTestCheckout(configuration, customer);
        return await repository.finalizeCheckoutReservation(idempotencyKey, reservation.reservationToken, session);
      } catch (error) {
        await repository.releaseCheckoutReservation(idempotencyKey, reservation.reservationToken).catch(() => undefined);
        throw error;
      }
    },
    verifyWebhook: (rawBody, headers) => verifyDodoTestWebhook(dodoTestConfigFromEnv(environment), rawBody, headers),
    confirmPaymentOnce: async (payment) => {
      if (!runtime.dodoTestRepository) {
        throw Object.assign(new Error("PostgreSQL persistence is required for test payment."), { code: "PAYMENTS_UNAVAILABLE" });
      }
      return runtime.dodoTestRepository.confirmPaymentOnce(payment);
    },
  };
  type DetailedHealth = {
    service: "agentfront-api";
    persistence: Awaited<ReturnType<typeof runtime.persistence.health>>;
    integrations: IntegrationHealth[];
  };
  let cachedHealth: { value: DetailedHealth; expiresAt: number } | null = null;
  let healthInFlight: Promise<DetailedHealth> | null = null;

  const detailedHealth = async (): Promise<DetailedHealth> => {
    const now = Date.now();
    if (cachedHealth && cachedHealth.expiresAt > now) return cachedHealth.value;
    if (healthInFlight) return healthInFlight;
    healthInFlight = Promise.all([
      Promise.all([
        runtime.providers.places.health(),
        runtime.providers.crm.health(),
        runtime.support.health(),
        runtime.providers.conversation.health(),
        runtime.telephony.health(),
        runtime.providers.developer.health(),
        runtime.providers.deployment.health(),
      ]),
      runtime.persistence.health(),
      runtime.salesRepository.getLatestWorkerHeartbeat().catch(() => null),
    ]).then(([integrations, persistence, heartbeat]) => {
      const checkedAt = new Date().toISOString();
      const durable = persistence.mode === "POSTGRESQL" && persistence.status === "CONNECTED";
      const lastSeen = heartbeat ? Date.parse(heartbeat.lastSeenAt) : Number.NaN;
      const workerFresh = Number.isFinite(lastSeen) && Date.now() - lastSeen <= 20_000 && Date.now() >= lastSeen;
      const jobQueue: IntegrationHealth = {
        integration: "jobQueue", provider: durable ? "PostgreSQL SalesJob" : "Local process",
        mode: durable ? "REAL" : "DEMO",
        status: durable ? "CONNECTED" : persistence.status === "DEGRADED" ? "DEGRADED" : "DEMO",
        message: durable ? "Durable PostgreSQL jobs and CRM outbox are reachable." : "No durable PostgreSQL job queue is available.", checkedAt,
      };
      const scheduler: IntegrationHealth = {
        integration: "scheduler", provider: "AgentFront Local Worker",
        mode: "DEMO", status: workerFresh ? "CONNECTED" : heartbeat || persistence.status === "DEGRADED" ? "DEGRADED" : "NOT_CONFIGURED",
        message: workerFresh ? `Worker heartbeat received at ${heartbeat!.lastSeenAt}.`
          : heartbeat ? `Worker heartbeat is stale (last seen ${heartbeat.lastSeenAt}).`
            : persistence.status === "DEGRADED" ? "Worker heartbeat cannot be verified while PostgreSQL is unavailable."
            : "No worker heartbeat found. Start npm run dev:worker with DATABASE_URL configured.",
        checkedAt,
      };
      const value: DetailedHealth = { service: "agentfront-api", persistence, integrations: [...integrations, jobQueue, scheduler] };
      cachedHealth = { value, expiresAt: Date.now() + healthTtlMs };
      return value;
    }).finally(() => {
      healthInFlight = null;
    });
    return healthInFlight;
  };

  const queuePipelineRun = async (leadId: string, eventType = "pipeline.run.failed", resumeKey?: string): Promise<void> => {
    if (await runtime.controlTower?.emergencyStopped() ?? runtime.environmentEmergencyStopped) {
      throw new HttpError(409, "EMERGENCY_STOPPED", "New pipeline work is paused by the emergency stop.");
    }
    if (runtime.controlTower) {
      const aggregate = await runtime.store.findByLeadId(leadId);
      if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found for durable continuation.");
      const key = resumeKey ?? `pipeline:${leadId}:${aggregate.lead.status}:${aggregate.lead.version}`;
      await runtime.controlTower.append({
        businessId: aggregate.business.id, sourceAgent: "SALES",
        eventType: "PIPELINE_CONTINUATION_REQUESTED",
        idempotencyKey: key,
        correlationId: aggregate.lead.projectId,
        message: `Persisted pipeline continuation requested from ${aggregate.lead.status}.`,
        payload: { leadId, state: aggregate.lead.status, providerMode: "LEGACY_PIPELINE" },
        nextJob: { agentType: ["BUILD_QUEUED", "BUILDING", "QA", "DEPLOYING", "SPEC_GENERATED"].includes(aggregate.lead.status)
          ? "DEVELOPER" : "SALES", type: "RUN_LEGACY_PIPELINE", payload: { leadId },
          dedupeKey: key,
          maxAttempts: 3 },
      });
      return;
    }
    queueMicrotask(() => {
      void runtime.orchestrator.run(leadId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown background pipeline failure.";
        process.stderr.write(`${JSON.stringify({ level: "error", leadId, event: eventType, message, timestamp: new Date().toISOString() })}\n`);
      });
    });
  };

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Vary", "Origin");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://agentfront.local");
      const { pathname, searchParams } = url;
      const publicRoute = (request.method === "GET" &&
        (pathname === "/" || pathname === "/api" || pathname === "/api/health" || pathname === "/api/auth/session")) ||
        (request.method === "POST" && (pathname === "/api/auth/session" || pathname === "/api/auth/logout" ||
          pathname === "/api/webhooks/dodo-test" || pathname === "/api/webhooks/sarvam/outbound"));
      const conversationCompletionLeadId = request.method === "POST"
        ? routeId(pathname, "/api/leads/", "/conversation/complete")
        : null;
      const founderConversationCompletionLeadId = request.method === "POST"
        ? routeId(pathname, "/api/leads/", "/conversation/complete-from-founder")
        : null;
      const completionBearer = conversationCompletionLeadId ? bearerToken(request) : null;
      const toolCompletionRequest = Boolean(
        conversationCompletionLeadId &&
        configuredConversationToolSecret &&
        completionBearer &&
        tokensMatch(completionBearer, configuredConversationToolSecret),
      );
      const voiceToolRequest = request.method === "POST" && pathname.startsWith("/api/voice/tools/");
      const authenticatedVoiceTool = Boolean(
        voiceToolRequest && configuredConversationToolSecret && bearerToken(request) &&
        tokensMatch(bearerToken(request)!, configuredConversationToolSecret),
      );
      if (voiceToolRequest && !authenticatedVoiceTool) authorizeConversationTool(request, configuredConversationToolSecret);
      if (!publicRoute && !toolCompletionRequest && !authenticatedVoiceTool) {
        authorizeRequest(request, configuredToken, sessionAuth, authenticationRequired);
      }

      const cookieHeader = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
      const bearer = bearerToken(request);
      const founderAuthenticated = !authenticationRequired || Boolean(
        configuredToken && (
          (bearer && tokensMatch(bearer, configuredToken)) || sessionAuth?.validates(cookieHeader)
        ),
      );

      if (await handleVoiceToolRoute(runtime, request, response, pathname)) return;
      if (await handleSarvamOutboundWebhook(runtime, request, response, pathname, searchParams, environment)) return;
      if (await handleSalesRoute(runtime, request, response, pathname, environment)) return;
      if (await handleDodoTestRoute(request, response, pathname, dodoTestRoutes)) return;

      if (request.method === "GET" && pathname === "/api/demo/spiceroute/payment") {
        const projectId = await currentSpiceRoutePaymentProjectId();
        let configured = true;
        try {
          dodoTestConfigFromEnv(environment, projectId);
        } catch {
          configured = false;
        }
        if (!runtime.dodoTestRepository) {
          sendJson(response, 200, {
            ok: true,
            data: {
              projectId,
              mode: "TEST" as const,
              status: "NOT_STARTED" as const,
              checkoutUrl: null,
              checkoutSessionId: null,
              paymentId: null,
              paidAt: null,
              crmSyncedAt: null,
              crmLastError: null,
              configured: false,
            },
          });
          return;
        }
        const payment = await runtime.dodoTestRepository.getPaymentStatus(projectId);
        sendJson(response, 200, { ok: true, data: { ...payment, configured } });
        return;
      }

      if (request.method === "GET" && pathname === "/api/auth/session") {
        sendJson(response, 200, {
          ok: true,
          data: {
            required: authenticationRequired,
            authenticated: founderAuthenticated,
            mode: configuredToken ? "SESSION" as const : "LOOPBACK_DEMO" as const,
          },
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/auth/session") {
        if (!authenticationRequired) {
          sendJson(response, 200, {
            ok: true,
            data: { required: false, authenticated: true, mode: "LOOPBACK_DEMO" as const },
          });
          return;
        }
        if (!configuredToken || !sessionAuth) {
          throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Founder authentication is required but no API token is configured.");
        }
        const address = request.socket?.remoteAddress || "unknown";
        const now = Date.now();
        for (const [key, value] of loginAttempts) {
          if (value.resetAt <= now) loginAttempts.delete(key);
        }
        if (!loginAttempts.has(address) && loginAttempts.size >= 1_000) {
          throw new HttpError(429, "AUTH_RATE_LIMITED", "Authentication is temporarily unavailable. Try again later.");
        }
        const attempt = loginAttempts.get(address);
        if (attempt && attempt.resetAt > now && attempt.count >= 5) {
          throw new HttpError(429, "AUTH_RATE_LIMITED", "Too many authentication attempts. Try again later.", {
            "Retry-After": String(Math.max(1, Math.ceil((attempt.resetAt - now) / 1_000))),
          });
        }
        const body = requireRecord(await readJson<unknown>(request), "request body");
        assertAllowedKeys(body, new Set(["token"]), "request body");
        const token = requireBoundedString(body.token, "token", 4_096);
        if (!sessionAuth.tokenMatches(token)) {
          const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60_000 };
          loginAttempts.set(address, { ...current, count: current.count + 1 });
          throw new HttpError(401, "UNAUTHORIZED", "The founder access token is invalid.");
        }
        loginAttempts.delete(address);
        response.setHeader("Set-Cookie", sessionAuth.createCookie());
        sendJson(response, 200, {
          ok: true,
          data: { required: true, authenticated: true, mode: "SESSION" as const },
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/auth/logout") {
        if (sessionAuth) response.setHeader("Set-Cookie", sessionAuth.clearCookie());
        sendJson(response, 200, {
          ok: true,
          data: {
            required: authenticationRequired,
            authenticated: !authenticationRequired,
            mode: configuredToken ? "SESSION" as const : "LOOPBACK_DEMO" as const,
          },
        });
        return;
      }

      if (request.method === "GET" && (pathname === "/" || pathname === "/api")) {
        sendJson(response, 200, {
          ok: true,
          data: { name: "AgentFront API", message: "Autonomous acquisition and delivery orchestration is online." },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          data: { service: "agentfront-api" as const, status: "ok" as const, checkedAt: new Date().toISOString() },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/integrations/health") {
        sendJson(response, 200, { ok: true, data: await detailedHealth() });
        return;
      }

      if (request.method === "GET" && pathname === "/api/dashboard") {
        const [metrics, campaigns, leads, events, workflows, agentRuns, emergencyStopped] = await Promise.all([
          runtime.store.dashboardMetrics(),
          runtime.store.listCampaigns(),
          runtime.store.list(),
          runtime.store.listEvents(200),
          runtime.controlTower?.listWorkflows(100) ?? Promise.resolve([]),
          runtime.controlTower?.listAgentRuns(100) ?? Promise.resolve([]),
          runtime.controlTower?.emergencyStopped() ?? Promise.resolve(runtime.environmentEmergencyStopped),
        ]);
        sendJson(response, 200, {
          ok: true,
          data: { metrics, campaigns, leads: leads.map(publicAggregate), events, workflows, agentRuns, emergencyStopped },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/workflows") {
        if (!runtime.controlTower) throw new HttpError(503, "DATABASE_REQUIRED", "Workflow status requires PostgreSQL.");
        sendJson(response, 200, { ok: true, data: await runtime.controlTower.listWorkflows(200) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/agent-runs") {
        if (!runtime.controlTower) throw new HttpError(503, "DATABASE_REQUIRED", "Agent runs require PostgreSQL.");
        sendJson(response, 200, { ok: true, data: await runtime.controlTower.listAgentRuns(200) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/control/emergency-stop") {
        sendJson(response, 200, { ok: true, data: { stopped: await runtime.controlTower?.emergencyStopped() ?? runtime.environmentEmergencyStopped } });
        return;
      }

      if (request.method === "POST" && pathname === "/api/control/emergency-stop") {
        if (!runtime.controlTower) throw new HttpError(503, "DATABASE_REQUIRED", "Emergency stop requires PostgreSQL.");
        const body = requireRecord(await readJson<unknown>(request), "request body");
        assertAllowedKeys(body, new Set(["stopped"]), "request body");
        if (typeof body.stopped !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "stopped must be a boolean.");
        await runtime.controlTower.setEmergencyStop(body.stopped);
        sendJson(response, 200, { ok: true, data: { stopped: await runtime.controlTower.emergencyStopped() } });
        return;
      }

      if (request.method === "GET" && pathname === "/api/crm/deals") {
        const crm = runtime.providers.crm;
        const [providerDeals, salesBusinesses] = await Promise.all([
          crm.listDeals(100),
          runtime.salesRepository.list({ limit: 500 }),
        ]);
        const correlatedDealIds = new Set(
          salesBusinesses
            .map((detail) => detail.business.freshworksDealId)
            .filter((dealId): dealId is string => Boolean(dealId)),
        );
        const deals = providerDeals.filter((deal) => correlatedDealIds.has(deal.id));
        sendJson(response, 200, {
          ok: true,
          data: {
            mode: crm.mode,
            provider: crm.name,
            consoleUrl: crm.getConsoleUrl(),
            deals,
            ignoredProviderRecords: providerDeals.length - deals.length,
          },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/metrics") {
        sendJson(response, 200, { ok: true, data: await runtime.store.dashboardMetrics() });
        return;
      }

      if (request.method === "GET" && pathname === "/api/campaigns") {
        sendJson(response, 200, { ok: true, data: await runtime.store.listCampaigns() });
        return;
      }

      const campaignAction = pathname.match(/^\/api\/campaigns\/([^/]+)\/(start|pause|stop|emergency-stop)$/);
      if (request.method === "POST" && campaignAction) {
        const statusByAction = {
          start: "RUNNING",
          pause: "PAUSED",
          stop: "STOPPED",
          "emergency-stop": "STOPPED",
        } as const satisfies Record<string, CampaignStatus>;
        const campaignId = decodeRouteIdentifier(campaignAction[1] ?? "", "campaignId");
        const action = campaignAction[2] as keyof typeof statusByAction;
        if (action === "start" && (await runtime.controlTower?.emergencyStopped() ?? runtime.environmentEmergencyStopped)) {
          throw new HttpError(409, "EMERGENCY_STOPPED", "Resume the emergency stop before starting a campaign.");
        }
        const campaign = await runtime.store.updateCampaignStatus(campaignId, statusByAction[action]);
        if (!campaign) throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
        if (action === "emergency-stop") await runtime.controlTower?.setEmergencyStop(true);
        if (action === "start" && runtime.controlTower) {
          // The old runner parks without an exception while the campaign is
          // paused. An explicit restart schedules each unfinished lead again;
          // provider-stage guards still decide which effects are permissible.
          const resumedAt = randomUUID();
          const eligible = new Set<PipelineState>([
            "QUALIFIED", "CRM_CREATED", "OUTREACH_READY", "REQUIREMENTS_COLLECTED",
            "NEGOTIATING", "DEAL_WON", "SPEC_GENERATED", "BUILD_QUEUED", "QA", "DEPLOYING",
          ]);
          const parked = (await runtime.store.list()).filter((item) =>
            item.lead.campaignId === campaignId && eligible.has(item.lead.status));
          for (const item of parked) {
            await queuePipelineRun(item.lead.id, "pipeline.campaign-resume.failed",
              `campaign-resume:${campaignId}:${resumedAt}:${item.lead.id}`);
          }
        }
        sendJson(response, 200, { ok: true, data: campaign });
        return;
      }

      if (request.method === "GET" && pathname === "/api/places/business-photo") {
        const businessId = searchParams.get("businessId") ?? "";
        const width = Number(searchParams.get("width") ?? 240);
        if (!businessId || businessId.length > 200) {
          throw new HttpError(400, "VALIDATION_ERROR", "A valid businessId is required.");
        }
        if (!Number.isFinite(width) || width < 120 || width > 1600) {
          throw new HttpError(400, "VALIDATION_ERROR", "Photo width must be between 120 and 1600 pixels.");
        }
        const business = await runtime.store.getBusiness(businessId);
        if (!business?.externalPlaceId || business.source !== "GOOGLE_PLACES") {
          throw new HttpError(404, "PHOTO_UNAVAILABLE", "No Google Places photo is available for this business.");
        }
        if (!runtime.providers.places.getBusinessPhotoUri) {
          throw new HttpError(404, "PHOTO_UNAVAILABLE", "This Places provider does not expose business photos.");
        }
        const photoUri = await runtime.providers.places.getBusinessPhotoUri(business.externalPlaceId, width);
        response.writeHead(302, { Location: photoUri, "Cache-Control": "private, max-age=3600", "Referrer-Policy": "no-referrer" });
        response.end();
        return;
      }

      if (request.method === "GET" && pathname === "/api/places/photo") {
        const photoName = searchParams.get("name") ?? "";
        const width = Number(searchParams.get("width") ?? 720);
        if (!runtime.providers.places.getPhotoUri) {
          throw new HttpError(404, "PHOTO_UNAVAILABLE", "This Places provider does not expose business photos.");
        }
        if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) {
          throw new HttpError(400, "VALIDATION_ERROR", "Invalid Google Places photo resource.");
        }
        if (!Number.isFinite(width) || width < 120 || width > 1600) {
          throw new HttpError(400, "VALIDATION_ERROR", "Photo width must be between 120 and 1600 pixels.");
        }
        const photoUri = await runtime.providers.places.getPhotoUri(photoName, width);
        response.writeHead(302, {
          Location: photoUri,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        });
        response.end();
        return;
      }

      if (request.method === "GET" && pathname === "/api/discover") {
        const requestedVertical = searchParams.get("vertical") ?? searchParams.get("businessType") ?? searchParams.get("category") ?? "restaurant";
        const vertical = resolveBusinessVertical(requestedVertical);
        if (!vertical) throw new HttpError(400, "VALIDATION_ERROR", "Unsupported business vertical.");
        const category = vertical.template;
        const location = requireBoundedString(searchParams.get("location") ?? "Sholinganallur, Chennai", "location", 200);
        const radiusMetres = Number(searchParams.get("radiusMetres") ?? 5_000);
        const websitePresence = (searchParams.get("websitePresence") ?? "ANY") as NonNullable<PlacesSearchRequest["websitePresence"]>;
        const minimumRating = Number(searchParams.get("minimumRating") ?? 0);
        const minimumReviewCount = Number(searchParams.get("minimumReviewCount") ?? 0);
        if (!Number.isSafeInteger(radiusMetres) || radiusMetres < 100 || radiusMetres > 50_000) {
          throw new HttpError(400, "VALIDATION_ERROR", "radiusMetres must be an integer between 100 and 50000.");
        }
        if (!websitePresences.has(websitePresence)) {
          throw new HttpError(400, "VALIDATION_ERROR", "websitePresence must be ANY, MISSING, or PRESENT.");
        }
        if (!Number.isFinite(minimumRating) || minimumRating < 0 || minimumRating > 5) {
          throw new HttpError(400, "VALIDATION_ERROR", "minimumRating must be between 0 and 5.");
        }
        if (!Number.isSafeInteger(minimumReviewCount) || minimumReviewCount < 0 || minimumReviewCount > 10_000_000) {
          throw new HttpError(400, "VALIDATION_ERROR", "minimumReviewCount must be an integer between 0 and 10000000.");
        }
        const search: PlacesSearchRequest = {
          location,
          businessType: category,
          searchQuery: vertical.searchQuery,
          verticalId: vertical.id,
          radiusMetres,
          websitePresence,
          minimumRating,
          minimumReviewCount,
        };
        const result = await runtime.providers.places.search(search);
        await runtime.store.upsertBusinesses(result.businesses);
        const campaign = (await runtime.store.listCampaigns())[0];
        const businesses = result.businesses.map((business) => ({
          ...business,
          opportunity: calculateOpportunityScore(business, campaign?.minimumOpportunityScore ?? 75),
        }));
        sendJson(response, 200, {
          ok: true,
          data: businesses,
          meta: { provider: runtime.providers.places.name, mode: result.mode, attribution: result.attribution, vertical: vertical.id, template: vertical.template },
        });
        return;
      }

      const businessId = routeId(pathname, "/api/businesses/");
      if (request.method === "GET" && businessId) {
        const business = await runtime.store.getBusiness(businessId);
        if (!business) throw new HttpError(404, "BUSINESS_NOT_FOUND", "Business was not found.");
        const campaign = (await runtime.store.listCampaigns())[0];
        sendJson(response, 200, {
          ok: true,
          data: { business, opportunity: calculateOpportunityScore(business, campaign?.minimumOpportunityScore ?? 75) },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/leads") {
        sendJson(response, 200, { ok: true, data: (await runtime.store.list()).map(publicAggregate) });
        return;
      }

      const leadId = routeId(pathname, "/api/leads/");
      if (request.method === "GET" && leadId) {
        const aggregate = await runtime.store.findByLeadId(leadId) ?? await runtime.store.findByProjectId(leadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        sendJson(response, 200, { ok: true, data: publicAggregate(aggregate) });
        return;
      }

      if (request.method === "POST" && pathname === "/api/pipeline/start") {
        const body = await readJson<{ businessId?: string; campaignId?: string; idempotencyKey?: string }>(request);
        const business = await runtime.store.getBusiness(body.businessId ?? "business-spiceroute");
        const campaign = await runtime.store.getCampaign(body.campaignId ?? "campaign-stage-1-demo");
        if (!business) throw new HttpError(404, "BUSINESS_NOT_FOUND", "Business was not found.");
        if (!campaign) throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
        if (campaign.status !== "RUNNING") throw new HttpError(409, "CAMPAIGN_NOT_RUNNING", "Campaign must be running.");
        const idempotencyKey = requireBoundedString(
          request.headers["idempotency-key"] ?? body.idempotencyKey,
          "idempotencyKey",
          128,
        );
        const aggregate = await runtime.orchestrator.start({ business, campaign, idempotencyKey });
        await queuePipelineRun(aggregate.lead.id);
        sendJson(response, 202, { ok: true, data: publicAggregate(aggregate), meta: { accepted: true, traceId: aggregate.lead.projectId } });
        return;
      }

      const startLeadId = routeId(pathname, "/api/leads/", "/start");
      if (request.method === "POST" && startLeadId) {
        const aggregate = await runtime.store.findByLeadId(startLeadId) ?? await runtime.store.findByProjectId(startLeadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        await queuePipelineRun(aggregate.lead.id);
        sendJson(response, 202, { ok: true, data: publicAggregate(aggregate), meta: { accepted: true } });
        return;
      }

      const retryLeadId = routeId(pathname, "/api/leads/", "/retry");
      if (request.method === "POST" && retryLeadId) {
        const body = await readJson<{ idempotencyKey?: string }>(request);
        const idempotencyKey = requireString(request.headers["idempotency-key"] ?? body.idempotencyKey, "idempotencyKey");
        const aggregate = await runtime.orchestrator.retry(retryLeadId, idempotencyKey, false);
        await queuePipelineRun(aggregate.lead.id, "pipeline.retry.failed");
        sendJson(response, 202, { ok: true, data: publicAggregate(aggregate), meta: { accepted: true } });
        return;
      }

      const conversationSessionLeadId = routeId(pathname, "/api/leads/", "/conversation/session");
      if (request.method === "POST" && conversationSessionLeadId) {
        const body = requireRecord(await readJson<unknown>(request), "request body");
        assertAllowedKeys(body, new Set(["consent", "idempotencyKey"]), "request body");
        const consent = requireRecord(body.consent, "consent");
        assertAllowedKeys(consent, new Set(["microphone", "transcript"]), "consent");
        if (consent.microphone !== true || consent.transcript !== true) {
          throw new HttpError(
            400,
            "CONVERSATION_CONSENT_REQUIRED",
            "Explicit microphone and transcript consent is required before issuing a browser session.",
          );
        }
        const idempotencyKey = requireBoundedString(
          request.headers["idempotency-key"] ?? body.idempotencyKey,
          "idempotencyKey",
          128,
        );
        const aggregate = await runtime.store.findByLeadId(conversationSessionLeadId) ??
          await runtime.store.findByProjectId(conversationSessionLeadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        if (aggregate.lead.status !== "CONVERSATION_ACTIVE" || !aggregate.conversation) {
          throw new HttpError(409, "CONVERSATION_NOT_READY", "The lead is not ready for a browser conversation.");
        }
        if (aggregate.conversation.providerMode !== "REAL") {
          throw new HttpError(409, "REAL_CONVERSATION_NOT_CONFIGURED", "The lead is using the demo conversation provider.");
        }
        if (!aggregate.conversation.providerConversationId.startsWith("pending-")) {
          throw new HttpError(409, "CONVERSATION_ALREADY_CONNECTED", "The real conversation is already connected.");
        }
        const issued = await runtime.conversationGrants.issue({
          leadId: aggregate.lead.id,
          logicalConversationId: aggregate.conversation.id,
          idempotencyKey,
          provider: runtime.providers.conversation,
          providerInput: {
            projectId: aggregate.lead.projectId,
            lead: aggregate.lead,
            business: aggregate.business,
            campaign: aggregate.campaign,
          },
        });
        const salesDetail = await runtime.salesRepository.getDetail(aggregate.business.id);
        const lastContact = salesDetail?.contacts.find((item) => item.id === salesDetail.memory?.lastContactId);
        const verified = Boolean(lastContact?.verified && lastContact.isDecisionMaker);
        const dynamicVariables = buildElevenLabsDynamicVariables({
          projectId: aggregate.lead.projectId,
          lead: aggregate.lead,
          business: aggregate.business,
          campaign: aggregate.campaign,
        }, {
          identityVerified: verified,
          contactName: lastContact?.name,
          contactRole: lastContact?.roles.join(", "),
          preferredLanguage: lastContact?.preferredLanguage,
          previousSummary: salesDetail?.memory?.summary,
          previousObjections: salesDetail?.memory?.objections,
          dealStage: salesDetail?.business.salesState,
          lastInteraction: salesDetail?.calls[0]?.summary,
          nextAction: salesDetail?.memory?.nextAction,
          websiteStatus: aggregate.business.website ? "PRESENT" : "MISSING",
        });
        sendJson(response, issued.replayed ? 200 : 201, {
          ok: true,
          data: { ...issued.grant, dynamicVariables },
          meta: { replayed: issued.replayed },
        });
        return;
      }

      const conversationConnectLeadId = routeId(pathname, "/api/leads/", "/conversation/connect");
      if (request.method === "POST" && conversationConnectLeadId) {
        const body = requireRecord(await readJson<unknown>(request), "request body");
        assertAllowedKeys(
          body,
          new Set(["grantId", "providerConversationId", "idempotencyKey"]),
          "request body",
        );
        const grantId = requireBoundedString(body.grantId, "grantId", 128);
        const providerConversationId = requireBoundedString(
          body.providerConversationId,
          "providerConversationId",
          128,
        );
        if (!routeIdentifierPattern.test(providerConversationId)) {
          throw new HttpError(400, "VALIDATION_ERROR", "providerConversationId contains unsupported characters.");
        }
        if (providerConversationId.startsWith("pending-")) {
          throw new HttpError(400, "VALIDATION_ERROR", "providerConversationId must be issued by the realtime provider.");
        }
        const idempotencyKey = requireBoundedString(
          request.headers["idempotency-key"] ?? body.idempotencyKey,
          "idempotencyKey",
          128,
        );
        const aggregate = await runtime.store.findByLeadId(conversationConnectLeadId) ??
          await runtime.store.findByProjectId(conversationConnectLeadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        const grant = runtime.conversationGrants.getForBinding(grantId, aggregate.lead.id);
        if (!grant) {
          throw new HttpError(410, "CONVERSATION_GRANT_EXPIRED", "The browser conversation grant is invalid or expired.");
        }
        const connected = await runtime.orchestrator.bindConversation(
          aggregate.lead.id,
          providerConversationId,
          idempotencyKey,
        );
        runtime.conversationGrants.markBound(grantId, aggregate.lead.id, providerConversationId);
        sendJson(response, 200, { ok: true, data: publicAggregate(connected) });
        return;
      }

      const conversationLeadId = conversationCompletionLeadId;
      if (request.method === "POST" && conversationLeadId) {
        const body = requireRecord(await readJson<unknown>(request), "request body");
        assertAllowedKeys(body, new Set(["outcome", "idempotencyKey", "providerConversationId"]), "request body");
        const outcome = validateConversationOutcome(body.outcome);
        const idempotencyKey = requireBoundedString(
          request.headers["idempotency-key"] ?? body.idempotencyKey,
          "idempotencyKey",
          128,
        );
        const aggregate = await runtime.store.findByLeadId(conversationLeadId) ??
          await runtime.store.findByProjectId(conversationLeadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        const providerConversationId = aggregate.conversation?.providerMode === "REAL"
          ? requireBoundedString(body.providerConversationId, "providerConversationId", 128)
          : undefined;
        if (aggregate.conversation?.providerMode === "REAL") {
          authorizeConversationTool(request, configuredConversationToolSecret);
          if (
            !providerConversationId ||
            !routeIdentifierPattern.test(providerConversationId) ||
            aggregate.conversation.providerConversationId.startsWith("pending-") ||
            aggregate.conversation.providerConversationId !== providerConversationId
          ) {
            throw new HttpError(
              409,
              "CONVERSATION_CORRELATION_MISMATCH",
              "The completion does not match the bound ElevenLabs conversation.",
            );
          }
        }
        const completed = await runtime.orchestrator.completeConversation(
          aggregate.lead.id,
          outcome,
          idempotencyKey,
          providerConversationId,
          false,
        );
        await queuePipelineRun(completed.lead.id, "pipeline.conversation-continuation.failed");
        sendJson(response, 202, {
          ok: true,
          data: publicAggregate(completed),
          meta: { accepted: true },
        });
        return;
      }

      if (request.method === "POST" && founderConversationCompletionLeadId) {
        const body = requireRecord(await readJson<unknown>(request), "request body");
        assertAllowedKeys(body, new Set(["outcome", "providerConversationId"]), "request body");
        const outcome = validateConversationOutcome(body.outcome);
        const providerConversationId = requireBoundedString(body.providerConversationId, "providerConversationId", 128);
        if (!routeIdentifierPattern.test(providerConversationId)) {
          throw new HttpError(400, "VALIDATION_ERROR", "providerConversationId contains unsupported characters.");
        }
        const idempotencyKey = requireBoundedString(request.headers["idempotency-key"], "Idempotency-Key", 128);
        const aggregate = await runtime.store.findByLeadId(founderConversationCompletionLeadId) ??
          await runtime.store.findByProjectId(founderConversationCompletionLeadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        if (
          aggregate.conversation?.providerMode !== "REAL" ||
          aggregate.conversation.providerConversationId.startsWith("pending-") ||
          aggregate.conversation.providerConversationId !== providerConversationId
        ) {
          throw new HttpError(409, "CONVERSATION_CORRELATION_MISMATCH", "Approve only a brief from the currently bound ElevenLabs conversation.");
        }
        const completed = await runtime.orchestrator.completeConversation(
          aggregate.lead.id,
          outcome,
          idempotencyKey,
          providerConversationId,
          false,
        );
        await queuePipelineRun(completed.lead.id, "pipeline.conversation-continuation.failed");
        sendJson(response, 202, { ok: true, data: publicAggregate(completed), meta: { accepted: true } });
        return;
      }

      if (request.method === "GET" && pathname === "/api/projects") {
        const aggregates = await runtime.store.list();
        sendJson(response, 200, { ok: true, data: aggregates.flatMap((aggregate) => aggregate.project ? [aggregate.project] : []) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/events") {
        const limit = Number(searchParams.get("limit") ?? 100);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          throw new HttpError(400, "VALIDATION_ERROR", "limit must be an integer between 1 and 500.");
        }
        const cursor = searchParams.get("after");
        if (cursor && !runtime.controlTower) throw new HttpError(503, "DATABASE_REQUIRED", "Durable event cursor requires PostgreSQL.");
        let events;
        try {
          events = cursor ? await runtime.controlTower!.eventsAfter(cursor, limit) : await runtime.store.listEvents(limit);
        } catch (error) {
          if (error instanceof TypeError) throw new HttpError(400, "INVALID_CURSOR", error.message);
          throw error;
        }
        sendJson(response, 200, { ok: true, data: events });
        return;
      }

      if (request.method === "GET" && pathname === "/api/events/stream") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write(`event: connected\ndata: ${JSON.stringify({ mode: "live", at: new Date().toISOString() })}\n\n`);
        if (runtime.controlTower) {
          let cursor = typeof request.headers["last-event-id"] === "string" ? request.headers["last-event-id"] : null;
          let polling = false;
          let closed = false;
          const sendEvent = (item: { id: string }) => {
            response.write(`id: ${item.id}\nevent: agent-event\ndata: ${JSON.stringify(item)}\n\n`);
            cursor = item.id;
          };
          const poll = async () => {
            if (polling || closed) return;
            polling = true;
            try {
              if (!cursor) {
                const recent = await runtime.controlTower!.recentEvents(100);
                for (const item of recent) sendEvent(item);
              }
              if (cursor) {
                for (let page = 0; page < 5 && !closed; page += 1) {
                  const batch = await runtime.controlTower!.eventsAfter(cursor, 200);
                  for (const item of batch) sendEvent(item);
                  if (batch.length < 200) break;
                }
              }
            } catch (error) {
              response.write(`event: stream-error\ndata: ${JSON.stringify({ message: error instanceof TypeError ? "Unknown event cursor; reconnect without it." : "Event store unavailable." })}\n\n`);
              if (error instanceof TypeError) cursor = null;
            } finally { polling = false; }
          };
          void poll();
          const interval = setInterval(() => { void poll(); }, 2_000);
          const heartbeat = setInterval(() => {
            if (!closed) response.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
          }, 20_000);
          request.on("close", () => { closed = true; clearInterval(interval); clearInterval(heartbeat); });
          return;
        }
        const unsubscribe = runtime.events.subscribe((event) => {
          response.write(`id: ${event.id}\nevent: agent-event\ndata: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => {
          response.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
        }, 20_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/analytics") {
        const aggregates = await runtime.store.list();
        const funnel = funnelOrder.map((state, index) => ({
          state,
          count: aggregates.filter((aggregate) => {
            const reached = aggregate.transitions.some((transition) => transition.to === state);
            const currentIndex = funnelOrder.indexOf(aggregate.lead.status as (typeof funnelOrder)[number]);
            return reached || aggregate.lead.status === state || currentIndex >= index;
          }).length,
        }));
        const byIndustry = Object.fromEntries(
          [...businessTypes].map((category) => {
            const matches = aggregates.filter((aggregate) => aggregate.business.category === category);
            return [category, {
              leads: matches.length,
              dealsWon: matches.filter((aggregate) => aggregate.deal?.status === "WON").length,
              revenue: matches.reduce((sum, aggregate) => sum + (aggregate.deal?.status === "WON" ? aggregate.deal.finalAmount : 0), 0),
            }];
          }),
        );
        sendJson(response, 200, { ok: true, data: { funnel, byIndustry } });
        return;
      }

      throw new HttpError(404, "NOT_FOUND", `No route for ${request.method ?? "UNKNOWN"} ${pathname}.`);
    } catch (error) {
      const known = error instanceof HttpError;
      if (known) {
        for (const [name, value] of Object.entries(error.headers)) response.setHeader(name, value);
      }
      sendJson(response, known ? error.statusCode : 500, {
        ok: false,
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "The request could not be completed.",
        },
      });
    }
  };
}
