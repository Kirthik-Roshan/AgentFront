import type {
  AgentEvent,
  Business,
  BusinessType,
  Campaign,
  Conversation,
  Deal,
  Deployment,
  Identifier,
  Lead,
  Project,
  ProjectSpecification,
  ProviderMode,
  Requirements,
  TranscriptTurn,
} from "./domain";

export type IntegrationName =
  | "places"
  | "crm"
  | "support"
  | "conversation"
  | "telephony"
  | "scheduler"
  | "jobQueue"
  | "developer"
  | "deployment";

export interface IntegrationHealth {
  integration: IntegrationName;
  provider: string;
  mode: ProviderMode;
  status: "CONNECTED" | "DEMO" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
  message: string;
  checkedAt: string;
}

export interface PlacesSearchRequest {
  location: string;
  businessType: BusinessType;
  searchQuery?: string;
  verticalId?: string;
  radiusMetres: number;
  websitePresence?: "ANY" | "MISSING" | "PRESENT";
  minimumRating?: number;
  minimumReviewCount?: number;
}

export interface PlacesSearchResult {
  businesses: Business[];
  mode: ProviderMode;
  attribution: string;
}

export interface PlacesProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  search(request: PlacesSearchRequest): Promise<PlacesSearchResult>;
  /** Resolves a short-lived photo URL without exposing provider credentials. */
  /** Resolves the primary photo for a persisted provider place ID. */
  getBusinessPhotoUri?(externalPlaceId: string, maximumWidth: number): Promise<string>;
  getPhotoUri?(photoName: string, maximumWidth: number): Promise<string>;
  health(): Promise<IntegrationHealth>;
}

export interface CRMAccountInput {
  projectId: string;
  business: Business;
}

export interface CRMContactInput {
  projectId: string;
  accountId: string;
  business: Business;
  displayName: string;
  /** Actual identified contact number; falls back to the public business line for legacy flows. */
  contactPhone?: string;
  /** Customer-approved email, preferred as Freshsales unique identifier when available. */
  contactEmail?: string | null;
}

export interface CRMDealInput {
  projectId: string;
  accountId: string;
  contactId: string;
  title: string;
  amount: number;
  currency: string;
  stage: string;
}

export interface CRMRecord {
  id: string;
  url: string | null;
  created: boolean;
}

export interface CRMDealRecord extends CRMRecord {
  stage: string;
  amount: number;
}

/** A read-only deal projection intended for an operator-facing CRM board. */
export interface CRMDealSummary {
  id: string;
  name: string;
  amount: number;
  stage: string;
  accountName: string | null;
  contactName: string | null;
  updatedAt: string | null;
  url: string | null;
}

export interface CRMProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  createAccount(input: CRMAccountInput, idempotencyKey: string): Promise<CRMRecord>;
  createContact(input: CRMContactInput, idempotencyKey: string): Promise<CRMRecord>;
  createDeal(input: CRMDealInput, idempotencyKey: string): Promise<CRMDealRecord>;
  updateDealStage(dealId: string, stage: string, amount?: number): Promise<CRMDealRecord>;
  addNote(dealId: string, note: string): Promise<void>;
  getDeal(dealId: string): Promise<CRMDealRecord | null>;
  listDeals(limit?: number): Promise<CRMDealSummary[]>;
  getConsoleUrl(): string | null;
  health(): Promise<IntegrationHealth>;
}

/** An operational exception or post-sale request, never a Freshsales deal. */
export interface SupportTicketInput {
  businessId: string;
  workflowId: string;
  correlationId: string;
  category:
    | "SALES_CALL_FAILED"
    | "BUILD_FAILED"
    | "DEPLOYMENT_FAILED"
    | "ADVERTISEMENT_FAILED"
    | "PAYMENT_ANOMALY"
    | "CLIENT_CHANGE_REQUEST";
  subject: string;
  description: string;
  priority: 1 | 2 | 3 | 4;
  retryCount?: number;
}

export interface SupportTicketResult {
  status: "CREATED" | "NOT_CONFIGURED";
  id: string | null;
  url: string | null;
}

export interface SupportProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  /** Caller must also persist a dedupe key; provider-local replay protection is not durable. */
  createTicket(input: SupportTicketInput, idempotencyKey: string): Promise<SupportTicketResult>;
  health(): Promise<IntegrationHealth>;
}

export interface ConversationSessionInput {
  projectId: string;
  lead: Lead;
  business: Business;
  campaign: Campaign;
}

export interface ConversationSession {
  id: string;
  clientToken: string | null;
  providerUrl: string | null;
  mode: ProviderMode;
}

export interface ConversationAccessGrant {
  signedUrl: string;
  expiresAt: string;
  mode: ProviderMode;
}

export interface ConversationOutcome {
  transcript: TranscriptTurn[];
  summary: string;
  sentiment: Conversation["sentiment"];
  requirements: Omit<Requirements, "id" | "leadId">;
  acceptedAmount: number | null;
}

export interface ConversationProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  createSession(input: ConversationSessionInput, idempotencyKey: string): Promise<ConversationSession>;
  authorizeClientSession(
    input: ConversationSessionInput,
    idempotencyKey: string,
  ): Promise<ConversationAccessGrant>;
  getConversation(conversationId: string): Promise<{ status: Conversation["status"] }>;
  getTranscript(conversationId: string): Promise<TranscriptTurn[]>;
  getOutcome(conversationId: string): Promise<ConversationOutcome | null>;
  endSession(conversationId: string): Promise<void>;
  health(): Promise<IntegrationHealth>;
}

export interface BuildRequest {
  project: Project;
  businessId: Identifier;
  specification: ProjectSpecification;
  templateRoot: string;
  outputRoot: string;
}

export interface BuildResult {
  buildPath: string;
  logs: string[];
  success: boolean;
  mode: ProviderMode;
}

export interface DeveloperProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  build(request: BuildRequest, onEvent?: (event: AgentEvent) => void): Promise<BuildResult>;
  health(): Promise<IntegrationHealth>;
}

export interface DeploymentRequest {
  project: Project;
  buildPath: string;
}

export interface DeploymentProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  deploy(request: DeploymentRequest, idempotencyKey: string): Promise<Deployment>;
  getStatus(deploymentId: string): Promise<Deployment | null>;
  health(): Promise<IntegrationHealth>;
}

export interface ProviderSet {
  places: PlacesProvider;
  crm: CRMProvider;
  conversation: ConversationProvider;
  developer: DeveloperProvider;
  deployment: DeploymentProvider;
}

export interface WorkflowArtifacts {
  conversation?: Conversation;
  requirements?: Requirements;
  deal?: Deal;
  project?: Project;
  deployment?: Deployment;
}
