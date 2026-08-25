import type { ActivityEvent, Business } from './types';

export type ApiConnectionState = 'connecting' | 'connected' | 'offline';

export type AuthSession = {
  required: boolean;
  authenticated: boolean;
  mode: 'SESSION' | 'LOOPBACK_DEMO';
};

export type PersistenceHealth = {
  mode: 'POSTGRESQL' | 'IN_MEMORY';
  durable: boolean;
  status: 'CONNECTED' | 'DEGRADED' | 'DEMO';
  message: string;
};

export type IntegrationHealth = {
  integration: 'places' | 'crm' | 'conversation' | 'developer' | 'deployment';
  provider: string;
  mode: 'REAL' | 'DEMO';
  status: 'CONNECTED' | 'DEMO' | 'DEGRADED' | 'NOT_CONFIGURED';
  message: string;
  checkedAt: string;
};

export type IntegrationHealthSnapshot = {
  persistence: PersistenceHealth;
  integrations: IntegrationHealth[];
};

export type AgentFrontEvent = {
  id: string;
  leadId: string | null;
  projectId: string | null;
  campaignId: string | null;
  agentType: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  durationMs: number | null;
  createdAt: string;
};

export type CampaignSummary = {
  id: string;
  name: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'STOPPED';
};

export type PipelineAggregate = {
  lead: {
    id: string;
    projectId: string;
    businessId: string;
    campaignId: string;
    status: string;
    updatedAt?: string;
  };
  business?: { id: string; name: string };
  campaign?: CampaignSummary;
  project?: {
    projectId: string;
    templateType: 'restaurant' | 'salon' | 'garments' | 'mechanic';
    status: string;
    qaStatus?: string;
  } | null;
  transitions: Array<{ to: string }>;
  events: AgentFrontEvent[];
  deployment?: {
    url: string;
    status?: string;
    provider?: string;
    providerMode?: 'REAL' | 'DEMO';
  } | null;
};

export type DashboardMetrics = {
  revenueEarned: number;
  estimatedPipelineValue: number;
  businessesDiscovered: number;
  qualifiedLeads: number;
  conversationsCompleted: number;
  dealsWon: number;
  conversionRate: number;
  websitesDeployed: number;
  currency: 'INR' | 'USD';
};

export type DashboardSnapshot = {
  metrics: DashboardMetrics;
  campaigns: CampaignSummary[];
  leads: PipelineAggregate[];
  events: AgentFrontEvent[];
};

export type DashboardProjection = {
  metrics: DashboardMetrics;
  pipelineStep: number;
  campaignStatus: 'running' | 'paused' | 'stopped' | null;
  campaignName: string | null;
  activeLeadId: string | null;
  activeProjectId: string | null;
  activeBusinessId: string | null;
  deploymentUrl: string | null;
  events: ActivityEvent[];
};

export type CRMBoardDeal = {
  id: string;
  name: string;
  amount: number;
  stage: string;
  accountName: string | null;
  contactName: string | null;
  updatedAt: string | null;
  url: string | null;
};

export type CRMBoardSnapshot = {
  mode: 'REAL' | 'DEMO';
  provider: string;
  consoleUrl: string | null;
  deals: CRMBoardDeal[];
};

export type BrowserConversationGrant = {
  grantId: string;
  logicalConversationId: string;
  signedUrl: string;
  expiresAt: string;
  mode: 'REAL';
};

export type DiscoveredBusiness = {
  id: string;
  name: string;
  category: 'restaurant' | 'salon' | 'garments' | 'mechanic';
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  rating: number;
  reviewCount: number;
  website: string | null;
  socialLinks: Record<string, string>;
  digitalPresenceStatus: 'NONE' | 'WEAK' | 'ADEQUATE' | 'STRONG';
  source: 'GOOGLE_PLACES' | 'DEMO';
  opportunity: { total: number; qualified: boolean };
};

export type DiscoveryMeta = {
  mode: 'REAL' | 'DEMO';
  provider: string;
  attribution: string;
};

export type DiscoveryResult = {
  businesses: DiscoveredBusiness[];
  meta: DiscoveryMeta;
};

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string };
};

type EnvelopeResult<T> = { data: T; meta: Record<string, unknown> };

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
const apiBase = configuredBase.replace(/\/$/, '');

async function requestEnvelope<T>(path: string, options: RequestInit = {}, timeoutMs = 5_000): Promise<EnvelopeResult<T>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: 'include',
      headers: { Accept: 'application/json', ...options.headers },
      signal: controller.signal,
    });
    const envelope = await response.json() as ApiEnvelope<T>;
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new Error(envelope.error?.message ?? `AgentFront API returned ${response.status}.`);
    }
    return { data: envelope.data, meta: envelope.meta ?? {} };
  } finally {
    window.clearTimeout(timer);
  }
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 5_000): Promise<T> {
  return (await requestEnvelope<T>(path, options, timeoutMs)).data;
}

export function getAuthSession(): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/session', { cache: 'no-store' }, 3_500);
}

export function loginWithToken(token: string): Promise<AuthSession> {
  return request<AuthSession>('/api/auth/session', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }, 8_000);
}

export async function logoutSession(): Promise<void> {
  await request<unknown>('/api/auth/logout', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function getIntegrationHealth(): Promise<IntegrationHealthSnapshot> {
  return request<IntegrationHealthSnapshot>('/api/integrations/health', { cache: 'no-store' }, 3_500);
}

export function getDashboard(): Promise<DashboardSnapshot> {
  return request<DashboardSnapshot>('/api/dashboard', { cache: 'no-store' }, 8_000);
}

export function getCRMBoard(): Promise<CRMBoardSnapshot> {
  return request<CRMBoardSnapshot>('/api/crm/deals', { cache: 'no-store' }, 12_000);
}

export async function discoverMarket(input: {
  location: string;
  category: DiscoveredBusiness['category'];
  radiusMetres: number;
}): Promise<DiscoveryResult> {
  const query = new URLSearchParams({
    location: input.location,
    businessType: input.category,
    radiusMetres: String(input.radiusMetres),
  });
  const result = await requestEnvelope<DiscoveredBusiness[]>(`/api/discover?${query.toString()}`, {}, 12_000);
  return validateDiscoveryProvenance(result.data, result.meta);
}

export function validateDiscoveryProvenance(
  businesses: DiscoveredBusiness[],
  meta: Record<string, unknown>,
): DiscoveryResult {
  if (
    (meta.mode !== 'REAL' && meta.mode !== 'DEMO') ||
    typeof meta.provider !== 'string' || meta.provider.trim().length === 0 ||
    typeof meta.attribution !== 'string' || meta.attribution.trim().length === 0
  ) {
    throw new Error('Discovery response did not include trustworthy provider provenance.');
  }
  const inconsistentSource = businesses.some((business) =>
    meta.mode === 'REAL' ? business.source !== 'GOOGLE_PLACES' : business.source !== 'DEMO',
  );
  if (inconsistentSource) {
    throw new Error('Discovery response provider provenance does not match its business records.');
  }
  return {
    businesses,
    meta: {
      mode: meta.mode,
      provider: meta.provider.trim(),
      attribution: meta.attribution.trim(),
    },
  };
}

export function mapDiscoveredBusinesses(result: DiscoveryResult): Business[] {
  return result.businesses.map((business, index) => ({
    id: business.id,
    projectId: business.source === 'DEMO' && business.id === 'business-spiceroute'
      ? 'AF-2026-000001'
      : undefined,
    source: business.source,
    name: business.name,
    category: `${business.category[0].toUpperCase()}${business.category.slice(1)}` as Business['category'],
    area: business.address.split(',').at(-1)?.trim() || business.city,
    city: business.city,
    latitude: business.latitude,
    longitude: business.longitude,
    rating: business.rating,
    reviews: business.reviewCount,
    phone: Boolean(business.phone),
    instagram: Boolean(business.socialLinks.instagram),
    website: Boolean(business.website),
    websiteQuality: business.digitalPresenceStatus === 'WEAK' ? 'poor' : business.website ? 'good' : 'none',
    opportunityScore: business.opportunity.total,
    mapX: 18 + (index * 17) % 70,
    mapY: 17 + (index * 23) % 68,
    qualified: business.opportunity.qualified,
    contact: business.source === 'DEMO' && business.id === 'business-spiceroute'
      ? 'Restaurant Owner'
      : 'Owner / Manager',
    lastActivity: 'Just discovered',
  }));
}

export function startPipelineRun(businessId: string, idempotencyKey: string): Promise<PipelineAggregate> {
  return request<PipelineAggregate>('/api/pipeline/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ businessId, campaignId: 'campaign-stage-1-demo' }),
  }, 12_000);
}

export function authorizeBrowserConversation(
  leadId: string,
  idempotencyKey: string,
): Promise<BrowserConversationGrant> {
  return request<BrowserConversationGrant>(`/api/leads/${encodeURIComponent(leadId)}/conversation/session`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ consent: { microphone: true, transcript: true } }),
  }, 12_000);
}

export function bindBrowserConversation(input: {
  leadId: string;
  grantId: string;
  providerConversationId: string;
  idempotencyKey: string;
}): Promise<PipelineAggregate> {
  return request<PipelineAggregate>(
    `/api/leads/${encodeURIComponent(input.leadId)}/conversation/connect`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        grantId: input.grantId,
        providerConversationId: input.providerConversationId,
      }),
    },
    12_000,
  );
}

export function completeFounderConversation(input: {
  leadId: string;
  providerConversationId: string;
  outcome: unknown;
  idempotencyKey: string;
}): Promise<PipelineAggregate> {
  return request<PipelineAggregate>(
    `/api/leads/${encodeURIComponent(input.leadId)}/conversation/complete-from-founder`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ providerConversationId: input.providerConversationId, outcome: input.outcome }),
    },
    20_000,
  );
}

export function updateCampaign(action: 'start' | 'pause' | 'emergency-stop'): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/campaigns/campaign-stage-1-demo/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function subscribeToAgentEvents(
  onEvent: (event: AgentFrontEvent) => void,
  onConnectionChange?: (connected: boolean) => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const stream = new EventSource(`${apiBase}/api/events/stream`, { withCredentials: true });
  stream.addEventListener('connected', () => onConnectionChange?.(true));
  stream.addEventListener('agent-event', (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent<string>).data) as AgentFrontEvent);
    } catch {
      // A malformed provider event must not break the founder console.
    }
  });
  stream.onerror = () => onConnectionChange?.(false);
  return () => stream.close();
}

export function mapAgentEvent(event: AgentFrontEvent): ActivityEvent {
  return {
    id: event.id,
    agent: event.agentType,
    eventType: event.eventType,
    message: event.message,
    status: event.status,
    createdAt: event.createdAt,
    durationMs: event.durationMs,
    metadata: event.metadata,
    leadId: event.leadId,
    projectId: event.projectId,
    campaignId: event.campaignId,
  };
}

export function dashboardProjection(snapshot: DashboardSnapshot): DashboardProjection {
  const leads = snapshot.leads ?? [];
  const active = leads.slice().sort((left, right) =>
    (right.lead.updatedAt ?? '').localeCompare(left.lead.updatedAt ?? ''),
  )[0];
  const campaign = snapshot.campaigns.find((item) => item.id === active?.lead.campaignId) ??
    snapshot.campaigns.find((item) => item.id === 'campaign-stage-1-demo') ??
    snapshot.campaigns[0] ?? active?.campaign;
  const campaignStatus: DashboardProjection['campaignStatus'] = campaign?.status === 'RUNNING'
    ? 'running'
    : campaign?.status === 'PAUSED'
      ? 'paused'
      : campaign?.status === 'STOPPED' || campaign?.status === 'DRAFT'
        ? 'stopped'
        : null;

  return {
    metrics: snapshot.metrics,
    pipelineStep: active ? pipelineStepForState(active.lead.status) : 1,
    campaignStatus,
    campaignName: campaign?.name ?? null,
    activeLeadId: active?.lead.id ?? null,
    activeProjectId: active?.lead.projectId ?? null,
    activeBusinessId: active?.lead.businessId ?? active?.business?.id ?? null,
    deploymentUrl: active?.deployment?.url ?? null,
    events: (snapshot.events ?? []).map(mapAgentEvent),
  };
}

export function mergeActivityEvents(
  current: readonly ActivityEvent[],
  incoming: readonly ActivityEvent[],
  limit = 200,
): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of current) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit));
}

export function pipelineStepForState(state: string): number {
  const steps: Record<string, number> = {
    DISCOVERED: 1,
    QUALIFIED: 2,
    CRM_CREATED: 3,
    OUTREACH_READY: 3,
    CONVERSATION_ACTIVE: 4,
    REQUIREMENTS_COLLECTED: 5,
    NEGOTIATING: 6,
    DEAL_WON: 6,
    SPEC_GENERATED: 7,
    BUILD_QUEUED: 7,
    BUILDING: 8,
    BUILD_FAILED: 8,
    QA: 9,
    DEPLOYING: 9,
    DEPLOY_FAILED: 9,
    DEPLOYED: 10,
  };
  return steps[state] ?? 1;
}
