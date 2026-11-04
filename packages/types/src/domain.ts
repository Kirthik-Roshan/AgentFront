export type ISODateString = string;
export type Identifier = string;
export type CurrencyCode = "INR" | "USD";
export type ProviderMode = "REAL" | "DEMO";

export type BusinessType = "restaurant" | "salon" | "garments" | "mechanic" | "clinic" | "education" | "realestate" | "fitness" | "bakery" | "legal" | "spa" | "dental" | "physiotherapy" | "petcare" | "catering" | "events" | "photography" | "interiors" | "travel" | "movers" | "appliance" | "trades" | "detailing" | "drivingschool" | "laundry" | "furniture" | "devicerepair" | "printing" | "florist" | "jewellery" | "tailoring" | "cloudkitchen";

export type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "STOPPED";

export type PipelineState =
  | "DISCOVERED"
  | "QUALIFIED"
  | "CRM_CREATED"
  | "OUTREACH_READY"
  | "CONVERSATION_ACTIVE"
  | "REQUIREMENTS_COLLECTED"
  | "NEGOTIATING"
  | "DEAL_WON"
  | "SPEC_GENERATED"
  | "BUILD_QUEUED"
  | "BUILDING"
  | "QA"
  | "DEPLOYING"
  | "DEPLOYED"
  | "REJECTED"
  | "NOT_INTERESTED"
  | "FOLLOW_UP"
  | "DEAL_LOST"
  | "BUILD_FAILED"
  | "DEPLOY_FAILED";

export const ACTIVE_PIPELINE_STATES: readonly PipelineState[] = [
  "DISCOVERED",
  "QUALIFIED",
  "CRM_CREATED",
  "OUTREACH_READY",
  "CONVERSATION_ACTIVE",
  "REQUIREMENTS_COLLECTED",
  "NEGOTIATING",
  "DEAL_WON",
  "SPEC_GENERATED",
  "BUILD_QUEUED",
  "BUILDING",
  "QA",
  "DEPLOYING",
  "DEPLOYED",
] as const;

export const TERMINAL_PIPELINE_STATES: readonly PipelineState[] = [
  "DEPLOYED",
  "REJECTED",
  "NOT_INTERESTED",
  "FOLLOW_UP",
  "DEAL_LOST",
  "BUILD_FAILED",
  "DEPLOY_FAILED",
] as const;

export interface QualificationPolicy {
  minimumRating: number;
  minimumReviewCount: number;
  requireMissingOrPoorWebsite: boolean;
  requirePhone: boolean;
}

export interface PricingPolicy {
  basePrice: number;
  minimumPrice: number;
  maximumPrice: number;
  maximumDiscountPercent: number;
  featurePrices: Partial<Record<ProjectFeature, number>>;
  currency: CurrencyCode;
}

export interface Campaign {
  id: Identifier;
  name: string;
  status: CampaignStatus;
  businessTypes: BusinessType[];
  locations: string[];
  qualificationPolicy: QualificationPolicy;
  minimumOpportunityScore: number;
  pricingPolicy: PricingPolicy;
  maximumCallsPerDay: number;
  callingWindow: { start: string; end: string; timezone: string };
  automaticProcessing: boolean;
  createdAt: ISODateString;
  startedAt: ISODateString | null;
  stoppedAt: ISODateString | null;
}

export type DigitalPresenceStatus = "NONE" | "WEAK" | "ADEQUATE" | "STRONG";

export interface Business {
  id: Identifier;
  /** Optional operator-facing code; the canonical identity remains `id`. */
  businessCode?: string | null;
  externalPlaceId: string | null;
  /** Durable sales-CRM identities; absent on unmigrated/demo projections. */
  freshworksAccountId?: string | null;
  freshworksDealId?: string | null;
  name: string;
  category: BusinessType;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  rating: number;
  reviewCount: number;
  website: string | null;
  googleMapsUrl: string | null;
  /** Ephemeral Google Places photo resource; never persist or expose the API key. */
  photoName?: string | null;
  photoAttribution?: { displayName: string; uri: string | null } | null;
  socialLinks: Record<string, string>;
  digitalPresenceStatus: DigitalPresenceStatus;
  onlineOrdering: boolean | null;
  reservationSystem: boolean | null;
  source: "GOOGLE_PLACES" | "DEMO";
  createdAt: ISODateString;
}

export interface ScoreFactor {
  key: string;
  label: string;
  points: number;
  maximum: number;
  reason: string;
}

export interface OpportunityScore {
  total: number;
  maximum: 100;
  qualified: boolean;
  factors: ScoreFactor[];
  reason: string;
}

export interface Lead {
  id: Identifier;
  projectId: string;
  businessId: Identifier;
  campaignId: Identifier;
  opportunityScore: number;
  scoreBreakdown: ScoreFactor[];
  qualificationReason: string;
  status: PipelineState;
  freshworksAccountId: string | null;
  freshworksContactId: string | null;
  freshworksDealId: string | null;
  version: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type ConversationStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED";
export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";

export interface TranscriptTurn {
  id: Identifier;
  speaker: "AGENT" | "CUSTOMER" | "SYSTEM";
  text: string;
  at: ISODateString;
}

export interface Conversation {
  id: Identifier;
  leadId: Identifier;
  provider: string;
  providerMode: ProviderMode;
  providerConversationId: string;
  clientToken: string | null;
  providerUrl: string | null;
  status: ConversationStatus;
  transcript: TranscriptTurn[];
  summary: string | null;
  sentiment: Sentiment;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
}

export type ProjectFeature =
  | "menu"
  | "gallery"
  | "whatsappOrdering"
  | "googleMaps"
  | "reservations"
  | "booking"
  | "testimonials"
  | "catalog"
  | "emergencyContact";

export interface Requirements {
  id: Identifier;
  leadId: Identifier;
  businessType: BusinessType;
  pages: string[];
  features: Partial<Record<ProjectFeature, boolean>>;
  branding: {
    style: string;
    primaryColour: string | null;
    mobileFirst: boolean;
  };
  contentRequirements: string[];
  budget: { minimum: number; maximum: number; currency: CurrencyCode };
  notes: string[];
  approvedAt: ISODateString | null;
}

export type DealStatus = "DRAFT" | "NEGOTIATING" | "WON" | "LOST";

export interface Deal {
  id: Identifier;
  leadId: Identifier;
  quotedAmount: number;
  discount: number;
  finalAmount: number;
  currency: CurrencyCode;
  status: DealStatus;
  acceptedAt: ISODateString | null;
  lostReason: string | null;
}

export interface ProjectSpecification {
  schemaVersion: 1;
  projectId: string;
  business: {
    name: string;
    type: BusinessType;
    location: string;
    phone: string;
  };
  commercial: {
    quotedPrice: number;
    finalPrice: number;
    currency: CurrencyCode;
  };
  pages: string[];
  features: Partial<Record<ProjectFeature, boolean>>;
  /** Approved, bounded requirements captured from the client conversation. */
  clientBrief?: string[];
  design: {
    style: string;
    primaryColour?: string;
    mobileFirst: true;
  };
}

export type ProjectStatus =
  | "SPEC_PENDING"
  | "SPEC_READY"
  | "QUEUED"
  | "BUILDING"
  | "QA"
  | "DEPLOYING"
  | "DEPLOYED"
  | "FAILED";

export interface QACheck {
  name: string;
  passed: boolean;
  blocking: boolean;
  message: string;
}

export interface QAResult {
  score: number;
  passed: boolean;
  checks: QACheck[];
}

export interface Project {
  id: Identifier;
  projectId: string;
  leadId: Identifier;
  templateType: BusinessType;
  specification: ProjectSpecification | null;
  status: ProjectStatus;
  buildPath: string | null;
  buildLog: string[];
  qaStatus: "PENDING" | "PASSED" | "FAILED";
  qaResult: QAResult | null;
  deploymentId: Identifier | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Deployment {
  id: Identifier;
  projectId: Identifier;
  provider: string;
  providerMode: ProviderMode;
  url: string;
  status: "PENDING" | "DEPLOYING" | "DEPLOYED" | "FAILED";
  deployedAt: ISODateString | null;
}

export type AgentType =
  | "DISCOVERY"
  | "QUALIFICATION"
  | "ORCHESTRATOR"
  | "CRM"
  | "SALES"
  | "NEGOTIATION"
  | "SPECIFICATION"
  | "DEVELOPER"
  | "QA"
  | "DEPLOYMENT"
  | "REVENUE";

export interface AgentEvent {
  id: Identifier;
  leadId: Identifier | null;
  projectId: string | null;
  campaignId: Identifier | null;
  agentType: AgentType;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  status: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  durationMs: number | null;
  createdAt: ISODateString;
  /** Nullable for events written before the five-agent cloud foundation. */
  businessId?: Identifier | null;
  workflowId?: Identifier | null;
  correlationId?: Identifier | null;
  sourceAgent?: import("./workflow").CoreAgent | null;
  retryCount?: number;
  payload?: Record<string, unknown> | null;
}

export interface PipelineTransition {
  id: Identifier;
  leadId: Identifier;
  projectId: string;
  from: PipelineState | null;
  to: PipelineState;
  actor: AgentType | "FOUNDER" | "SYSTEM";
  reason: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: ISODateString;
}

export interface RevenueEvent {
  id: Identifier;
  dealId: Identifier;
  amount: number;
  currency: CurrencyCode;
  type: "BOOKED" | "COLLECTED" | "REFUNDED";
  createdAt: ISODateString;
}

export interface LeadAggregate {
  lead: Lead;
  business: Business;
  campaign: Campaign;
  conversation: Conversation | null;
  requirements: Requirements | null;
  deal: Deal | null;
  project: Project | null;
  deployment: Deployment | null;
  transitions: PipelineTransition[];
  events: AgentEvent[];
  revenueEvents: RevenueEvent[];
}

export interface DashboardMetrics {
  revenueEarned: number;
  estimatedPipelineValue: number;
  businessesDiscovered: number;
  qualifiedLeads: number;
  conversationsCompleted: number;
  dealsWon: number;
  conversionRate: number;
  websitesDeployed: number;
  currency: CurrencyCode;
}
