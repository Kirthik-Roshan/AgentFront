import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { calculateOpportunityScore } from "@agentfront/scoring";
import type {
  ApiResponse,
  BusinessType,
  CampaignStatus,
  ConversationOutcome,
  LeadAggregate,
  PipelineState,
  PlacesSearchRequest,
  ProjectFeature,
} from "@agentfront/types";
import type { ApiRuntime } from "./runtime";
import { FounderSessionAuth } from "./session-auth";

const businessTypes = new Set<BusinessType>(["restaurant", "salon", "garments", "mechanic"]);
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
  const explicitLoopbackDemo = environment.ALLOW_UNAUTHENTICATED_LOOPBACK_DEMO?.trim().toLowerCase() === "true";
  const authenticationRequired = Boolean(configuredToken) || !isLoopbackHost(bindHost) || (production && !explicitLoopbackDemo);
  const origin = environment.WEB_ORIGIN?.trim() || "http://localhost:3000";
  const sessionAuth = configuredToken
    ? new FounderSessionAuth({
        apiToken: configuredToken,
        sessionSecret: environment.AGENTFRONT_SESSION_SECRET,
        secureCookie: production || origin.startsWith("https://"),
      })
    : null;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const healthTtlMs = Math.max(1_000, Number(environment.AGENTFRONT_HEALTH_TTL_MS ?? 30_000) || 30_000);
  type DetailedHealth = {
    service: "agentfront-api";
    persistence: Awaited<ReturnType<typeof runtime.persistence.health>>;
    integrations: Awaited<ReturnType<typeof runtime.providers.places.health>>[];
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
        runtime.providers.conversation.health(),
        runtime.providers.developer.health(),
        runtime.providers.deployment.health(),
      ]),
      runtime.persistence.health(),
    ]).then(([integrations, persistence]) => {
      const value: DetailedHealth = { service: "agentfront-api", persistence, integrations };
      cachedHealth = { value, expiresAt: Date.now() + healthTtlMs };
      return value;
    }).finally(() => {
      healthInFlight = null;
    });
    return healthInFlight;
  };

  const queuePipelineRun = (leadId: string, eventType = "pipeline.run.failed"): void => {
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
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://agentfront.local");
      const { pathname, searchParams } = url;
      const publicRoute = (request.method === "GET" &&
        (pathname === "/" || pathname === "/api" || pathname === "/api/health" || pathname === "/api/auth/session")) ||
        (request.method === "POST" && (pathname === "/api/auth/session" || pathname === "/api/auth/logout"));
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
      if (!publicRoute && !toolCompletionRequest) {
        authorizeRequest(request, configuredToken, sessionAuth, authenticationRequired);
      }

      const cookieHeader = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
      const bearer = bearerToken(request);
      const founderAuthenticated = !authenticationRequired || Boolean(
        configuredToken && (
          (bearer && tokensMatch(bearer, configuredToken)) || sessionAuth?.validates(cookieHeader)
        ),
      );

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
        const [metrics, campaigns, leads, events] = await Promise.all([
          runtime.store.dashboardMetrics(),
          runtime.store.listCampaigns(),
          runtime.store.list(),
          runtime.store.listEvents(200),
        ]);
        sendJson(response, 200, {
          ok: true,
          data: { metrics, campaigns, leads: leads.map(publicAggregate), events },
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/crm/deals") {
        const crm = runtime.providers.crm;
        const deals = await crm.listDeals(100);
        sendJson(response, 200, {
          ok: true,
          data: {
            mode: crm.mode,
            provider: crm.name,
            consoleUrl: crm.getConsoleUrl(),
            deals,
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
        const campaign = await runtime.store.updateCampaignStatus(campaignId, statusByAction[action]);
        if (!campaign) throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
        sendJson(response, 200, { ok: true, data: campaign });
        return;
      }

      if (request.method === "GET" && (pathname === "/api/discover" || pathname === "/api/businesses")) {
        const category = (searchParams.get("businessType") ?? searchParams.get("category") ?? "restaurant") as BusinessType;
        if (!businessTypes.has(category)) throw new HttpError(400, "VALIDATION_ERROR", "Unsupported business type.");
        const search: PlacesSearchRequest = {
          location: searchParams.get("location") ?? "Sholinganallur, Chennai",
          businessType: category,
          radiusMetres: Number(searchParams.get("radiusMetres") ?? 5_000),
          websitePresence: (searchParams.get("websitePresence") as PlacesSearchRequest["websitePresence"]) ?? "ANY",
          minimumRating: Number(searchParams.get("minimumRating") ?? 0),
          minimumReviewCount: Number(searchParams.get("minimumReviewCount") ?? 0),
        };
        if (!Number.isFinite(search.radiusMetres) || search.radiusMetres < 100 || search.radiusMetres > 50_000) {
          throw new HttpError(400, "VALIDATION_ERROR", "radiusMetres must be between 100 and 50000.");
        }
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
          meta: { provider: runtime.providers.places.name, mode: result.mode, attribution: result.attribution },
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

      if (request.method === "POST" && (pathname === "/api/pipeline/start" || pathname === "/api/demo/run")) {
        const body = await readJson<{ businessId?: string; campaignId?: string; idempotencyKey?: string }>(request);
        const business = await runtime.store.getBusiness(body.businessId ?? "business-spiceroute");
        const campaign = await runtime.store.getCampaign(body.campaignId ?? "campaign-stage-1-demo");
        if (!business) throw new HttpError(404, "BUSINESS_NOT_FOUND", "Business was not found.");
        if (!campaign) throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
        if (campaign.status !== "RUNNING") throw new HttpError(409, "CAMPAIGN_NOT_RUNNING", "Campaign must be running.");
        const idempotencyKey = requireString(request.headers["idempotency-key"] ?? body.idempotencyKey, "idempotencyKey");
        const aggregate = await runtime.orchestrator.start({ business, campaign, idempotencyKey });
        queuePipelineRun(aggregate.lead.id);
        sendJson(response, 202, { ok: true, data: publicAggregate(aggregate), meta: { accepted: true, traceId: aggregate.lead.projectId } });
        return;
      }

      const startLeadId = routeId(pathname, "/api/leads/", "/start");
      if (request.method === "POST" && startLeadId) {
        const aggregate = await runtime.store.findByLeadId(startLeadId) ?? await runtime.store.findByProjectId(startLeadId);
        if (!aggregate) throw new HttpError(404, "LEAD_NOT_FOUND", "Lead was not found.");
        queuePipelineRun(aggregate.lead.id);
        sendJson(response, 202, { ok: true, data: publicAggregate(aggregate), meta: { accepted: true } });
        return;
      }

      const retryLeadId = routeId(pathname, "/api/leads/", "/retry");
      if (request.method === "POST" && retryLeadId) {
        const body = await readJson<{ idempotencyKey?: string }>(request);
        const idempotencyKey = requireString(request.headers["idempotency-key"] ?? body.idempotencyKey, "idempotencyKey");
        const aggregate = await runtime.orchestrator.retry(retryLeadId, idempotencyKey, false);
        queuePipelineRun(aggregate.lead.id, "pipeline.retry.failed");
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
        sendJson(response, issued.replayed ? 200 : 201, {
          ok: true,
          data: issued.grant,
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
        queuePipelineRun(completed.lead.id, "pipeline.conversation-continuation.failed");
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
        queuePipelineRun(completed.lead.id, "pipeline.conversation-continuation.failed");
        sendJson(response, 202, { ok: true, data: publicAggregate(completed), meta: { accepted: true } });
        return;
      }

      if (request.method === "GET" && pathname === "/api/projects") {
        const aggregates = await runtime.store.list();
        sendJson(response, 200, { ok: true, data: aggregates.flatMap((aggregate) => aggregate.project ? [aggregate.project] : []) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/events") {
        const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 100)));
        sendJson(response, 200, { ok: true, data: await runtime.store.listEvents(limit) });
        return;
      }

      if (request.method === "GET" && (pathname === "/api/events/stream" || pathname === "/api/stream")) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write(`event: connected\ndata: ${JSON.stringify({ mode: "live", at: new Date().toISOString() })}\n\n`);
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
