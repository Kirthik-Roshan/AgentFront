import type {
  AgentEvent,
  AgentType,
  Business,
  BusinessType,
  Campaign,
  CampaignStatus,
  Conversation,
  ConversationStatus,
  CurrencyCode,
  Deal,
  DealStatus,
  Deployment,
  DigitalPresenceStatus,
  Lead,
  LeadAggregate,
  PipelineState,
  PipelineTransition,
  Project,
  ProjectStatus,
  ProviderMode,
  Requirements,
  RevenueEvent,
  Sentiment,
} from "@agentfront/types";

type DateValue = Date | string;
type DecimalValue = number | string | { toString(): string };

export interface PersistedBusinessRecord {
  id: string;
  externalPlaceId: string | null;
  name: string;
  category: string;
  address: string;
  city: string;
  latitude: DecimalValue;
  longitude: DecimalValue;
  phone: string | null;
  rating: DecimalValue;
  reviewCount: number;
  website: string | null;
  googleMapsUrl: string | null;
  socialLinks: unknown;
  digitalPresenceStatus: string;
  onlineOrdering: boolean | null;
  reservationSystem: boolean | null;
  source: string;
  createdAt: DateValue;
}

export interface PersistedCampaignRecord {
  id: string;
  name: string;
  status: string;
  businessTypes: unknown;
  locations: unknown;
  qualificationPolicy: unknown;
  minimumOpportunityScore: number;
  pricingPolicy: unknown;
  maximumCallsPerDay: number;
  callingWindow: unknown;
  automaticProcessing: boolean;
  createdAt: DateValue;
  startedAt: DateValue | null;
  stoppedAt: DateValue | null;
}

interface PersistedConversationRecord {
  id: string;
  leadId: string;
  provider: string;
  providerMode: string;
  providerConversationId: string;
  clientToken: string | null;
  providerUrl: string | null;
  status: string;
  transcript: unknown;
  summary: string | null;
  sentiment: string;
  startedAt: DateValue | null;
  endedAt: DateValue | null;
}

interface PersistedRequirementsRecord {
  id: string;
  leadId: string;
  businessType: string;
  pages: unknown;
  features: unknown;
  branding: unknown;
  contentRequirements: unknown;
  budget: unknown;
  notes: unknown;
  approvedAt: DateValue | null;
}

interface PersistedRevenueRecord {
  id: string;
  dealId: string;
  amount: number;
  currency: string;
  type: string;
  createdAt: DateValue;
}

interface PersistedDealRecord {
  id: string;
  leadId: string;
  quotedAmount: number;
  discount: number;
  finalAmount: number;
  currency: string;
  status: string;
  acceptedAt: DateValue | null;
  lostReason: string | null;
  revenueEvents: PersistedRevenueRecord[];
}

interface PersistedDeploymentRecord {
  id: string;
  projectId: string;
  provider: string;
  providerMode: string;
  url: string;
  status: string;
  deployedAt: DateValue | null;
}

interface PersistedProjectRecord {
  id: string;
  projectId: string;
  leadId: string;
  templateType: string;
  specification: unknown | null;
  status: string;
  buildPath: string | null;
  buildLog: unknown;
  qaStatus: string;
  qaResult: unknown | null;
  createdAt: DateValue;
  updatedAt: DateValue;
  deployment: PersistedDeploymentRecord | null;
}

interface PersistedTransitionRecord {
  id: string;
  leadId: string;
  projectId: string;
  from: string | null;
  to: string;
  actor: string;
  reason: string;
  idempotencyKey: string;
  metadata: unknown;
  createdAt: DateValue;
}

export interface PersistedAgentEventRecord {
  id: string;
  leadId: string | null;
  projectId: string | null;
  campaignId: string | null;
  agentType: string;
  eventType: string;
  message: string;
  metadata: unknown;
  status: string;
  durationMs: number | null;
  createdAt: DateValue;
}

export interface PersistedLeadAggregateRecord {
  id: string;
  projectId: string;
  businessId: string;
  campaignId: string;
  opportunityScore: number;
  scoreBreakdown: unknown;
  qualificationReason: string;
  status: string;
  freshworksAccountId: string | null;
  freshworksContactId: string | null;
  freshworksDealId: string | null;
  version: number;
  createdAt: DateValue;
  updatedAt: DateValue;
  business: PersistedBusinessRecord;
  campaign: PersistedCampaignRecord;
  conversations: PersistedConversationRecord[];
  requirements: PersistedRequirementsRecord | null;
  deal: PersistedDealRecord | null;
  project: PersistedProjectRecord | null;
  transitions: PersistedTransitionRecord[];
  agentEvents: PersistedAgentEventRecord[];
}

const iso = (value: DateValue): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const nullableIso = (value: DateValue | null): string | null => value === null ? null : iso(value);
const json = <T>(value: unknown): T => structuredClone(value) as T;

export function mapPersistedBusiness(row: PersistedBusinessRecord): Business {
  return {
    id: row.id,
    externalPlaceId: row.externalPlaceId,
    name: row.name,
    category: row.category as BusinessType,
    address: row.address,
    city: row.city,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    phone: row.phone,
    rating: Number(row.rating),
    reviewCount: row.reviewCount,
    website: row.website,
    googleMapsUrl: row.googleMapsUrl,
    socialLinks: json<Record<string, string>>(row.socialLinks),
    digitalPresenceStatus: row.digitalPresenceStatus as DigitalPresenceStatus,
    onlineOrdering: row.onlineOrdering,
    reservationSystem: row.reservationSystem,
    source: row.source as Business["source"],
    createdAt: iso(row.createdAt),
  };
}

export function mapPersistedCampaign(row: PersistedCampaignRecord): Campaign {
  return {
    id: row.id,
    name: row.name,
    status: row.status as CampaignStatus,
    businessTypes: json<Campaign["businessTypes"]>(row.businessTypes),
    locations: json<Campaign["locations"]>(row.locations),
    qualificationPolicy: json<Campaign["qualificationPolicy"]>(row.qualificationPolicy),
    minimumOpportunityScore: row.minimumOpportunityScore,
    pricingPolicy: json<Campaign["pricingPolicy"]>(row.pricingPolicy),
    maximumCallsPerDay: row.maximumCallsPerDay,
    callingWindow: json<Campaign["callingWindow"]>(row.callingWindow),
    automaticProcessing: row.automaticProcessing,
    createdAt: iso(row.createdAt),
    startedAt: nullableIso(row.startedAt),
    stoppedAt: nullableIso(row.stoppedAt),
  };
}

export function mapPersistedAgentEvent(row: PersistedAgentEventRecord): AgentEvent {
  return {
    id: row.id,
    leadId: row.leadId,
    projectId: row.projectId,
    campaignId: row.campaignId,
    agentType: row.agentType as AgentType,
    eventType: row.eventType,
    message: row.message,
    metadata: json<Record<string, unknown>>(row.metadata),
    status: row.status as AgentEvent["status"],
    durationMs: row.durationMs,
    createdAt: iso(row.createdAt),
  };
}

export function mapPersistedLeadAggregate(row: PersistedLeadAggregateRecord): LeadAggregate {
  const lead: Lead = {
    id: row.id,
    projectId: row.projectId,
    businessId: row.businessId,
    campaignId: row.campaignId,
    opportunityScore: row.opportunityScore,
    scoreBreakdown: json<Lead["scoreBreakdown"]>(row.scoreBreakdown),
    qualificationReason: row.qualificationReason,
    status: row.status as PipelineState,
    freshworksAccountId: row.freshworksAccountId,
    freshworksContactId: row.freshworksContactId,
    freshworksDealId: row.freshworksDealId,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  const conversationRow = row.conversations[0] ?? null;
  const conversation: Conversation | null = conversationRow ? {
    id: conversationRow.id,
    leadId: conversationRow.leadId,
    provider: conversationRow.provider,
    providerMode: conversationRow.providerMode as ProviderMode,
    providerConversationId: conversationRow.providerConversationId,
    clientToken: conversationRow.clientToken,
    providerUrl: conversationRow.providerUrl,
    status: conversationRow.status as ConversationStatus,
    transcript: json<Conversation["transcript"]>(conversationRow.transcript),
    summary: conversationRow.summary,
    sentiment: conversationRow.sentiment as Sentiment,
    startedAt: nullableIso(conversationRow.startedAt),
    endedAt: nullableIso(conversationRow.endedAt),
  } : null;
  const requirements: Requirements | null = row.requirements ? {
    id: row.requirements.id,
    leadId: row.requirements.leadId,
    businessType: row.requirements.businessType as BusinessType,
    pages: json<Requirements["pages"]>(row.requirements.pages),
    features: json<Requirements["features"]>(row.requirements.features),
    branding: json<Requirements["branding"]>(row.requirements.branding),
    contentRequirements: json<Requirements["contentRequirements"]>(row.requirements.contentRequirements),
    budget: json<Requirements["budget"]>(row.requirements.budget),
    notes: json<Requirements["notes"]>(row.requirements.notes),
    approvedAt: nullableIso(row.requirements.approvedAt),
  } : null;
  const deal: Deal | null = row.deal ? {
    id: row.deal.id,
    leadId: row.deal.leadId,
    quotedAmount: row.deal.quotedAmount,
    discount: row.deal.discount,
    finalAmount: row.deal.finalAmount,
    currency: row.deal.currency as CurrencyCode,
    status: row.deal.status as DealStatus,
    acceptedAt: nullableIso(row.deal.acceptedAt),
    lostReason: row.deal.lostReason,
  } : null;
  const project: Project | null = row.project ? {
    id: row.project.id,
    projectId: row.project.projectId,
    leadId: row.project.leadId,
    templateType: row.project.templateType as BusinessType,
    specification: row.project.specification === null ? null : json<Project["specification"]>(row.project.specification),
    status: row.project.status as ProjectStatus,
    buildPath: row.project.buildPath,
    buildLog: json<Project["buildLog"]>(row.project.buildLog),
    qaStatus: row.project.qaStatus as Project["qaStatus"],
    qaResult: row.project.qaResult === null ? null : json<Project["qaResult"]>(row.project.qaResult),
    deploymentId: row.project.deployment?.id ?? null,
    createdAt: iso(row.project.createdAt),
    updatedAt: iso(row.project.updatedAt),
  } : null;
  const deployment: Deployment | null = row.project?.deployment ? {
    id: row.project.deployment.id,
    projectId: row.project.deployment.projectId,
    provider: row.project.deployment.provider,
    providerMode: row.project.deployment.providerMode as ProviderMode,
    url: row.project.deployment.url,
    status: row.project.deployment.status as Deployment["status"],
    deployedAt: nullableIso(row.project.deployment.deployedAt),
  } : null;
  const transitions: PipelineTransition[] = row.transitions.map((transition) => ({
    id: transition.id,
    leadId: transition.leadId,
    projectId: transition.projectId,
    from: transition.from as PipelineState | null,
    to: transition.to as PipelineState,
    actor: transition.actor as PipelineTransition["actor"],
    reason: transition.reason,
    idempotencyKey: transition.idempotencyKey,
    metadata: json<Record<string, unknown>>(transition.metadata),
    createdAt: iso(transition.createdAt),
  }));
  const revenueEvents: RevenueEvent[] = (row.deal?.revenueEvents ?? []).map((event) => ({
    id: event.id,
    dealId: event.dealId,
    amount: event.amount,
    currency: event.currency as CurrencyCode,
    type: event.type as RevenueEvent["type"],
    createdAt: iso(event.createdAt),
  }));
  return {
    lead,
    business: mapPersistedBusiness(row.business),
    campaign: mapPersistedCampaign(row.campaign),
    conversation,
    requirements,
    deal,
    project,
    deployment,
    transitions,
    events: row.agentEvents.map(mapPersistedAgentEvent),
    revenueEvents,
  };
}
