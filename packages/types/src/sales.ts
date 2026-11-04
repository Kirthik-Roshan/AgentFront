import type { Business, BusinessType, CurrencyCode, ISODateString, Identifier } from "./domain";

export const SALES_STATES = [
  "DISCOVERED",
  "QUALIFIED",
  "CALL_PENDING",
  "CALLING",
  "CONTACTED",
  "RECEPTIONIST_CONTACTED",
  "DECISION_MAKER_REQUIRED",
  "OWNER_CONTACT_IDENTIFIED",
  "CALLBACK_REQUESTED",
  "FOLLOW_UP_SCHEDULED",
  "OWNER_CONTACTED",
  "DISCOVERY_CONVERSATION",
  "REQUIREMENTS_COLLECTING",
  "NEGOTIATING",
  "QUOTE_PRESENTED",
  "FOLLOW_UP_REQUIRED",
  "DEAL_WON",
  "DEAL_LOST",
  "DO_NOT_CONTACT",
  "SPEC_GENERATED",
  "BUILD_PENDING",
  "BUILDING",
  "QA",
  "DEPLOYING",
  "DEPLOYED",
] as const;

export type SalesState = (typeof SALES_STATES)[number];

export type ContactRole =
  | "OWNER"
  | "CO_OWNER"
  | "MANAGER"
  | "DECISION_MAKER"
  | "RECEPTIONIST"
  | "EMPLOYEE"
  | "UNKNOWN";

export type ContactSource =
  | "PUBLIC_LISTING"
  | "RECEPTIONIST_REFERRAL"
  | "INBOUND_CALL"
  | "OUTBOUND_CALL"
  | "CRM"
  | "FOUNDER"
  | "DEMO";

export type SupportedSalesLanguage =
  | "ENGLISH"
  | "HINDI"
  | "TAMIL"
  | "KANNADA"
  | "TELUGU"
  | "MALAYALAM";

export interface SalesBusiness extends Business {
  businessCode: string | null;
  freshworksAccountId: string | null;
  freshworksDealId: string | null;
  salesState: SalesState;
  updatedAt: ISODateString;
}

export interface Contact {
  id: Identifier;
  businessId: Identifier;
  freshworksContactId?: string | null;
  name: string | null;
  phone: string;
  normalizedPhone: string;
  roles: ContactRole[];
  isDecisionMaker: boolean;
  preferredLanguage: SupportedSalesLanguage | null;
  source: ContactSource;
  verified: boolean;
  dedupeKey: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CallDirection = "INBOUND" | "OUTBOUND";

export type SalesCallStatus =
  | "QUEUED"
  | "INITIATING"
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "BUSY"
  | "FAILED"
  | "CANCELLED";

export type SalesCallOutcome =
  | "UNKNOWN"
  | "RECEPTIONIST_REACHED"
  | "DECISION_MAKER_REACHED"
  | "OWNER_CONTACT_CAPTURED"
  | "CALLBACK_REQUESTED"
  | "FOLLOW_UP_REQUIRED"
  | "DEAL_WON"
  | "DEAL_LOST"
  | "DO_NOT_CONTACT"
  | "NO_ANSWER"
  | "FAILED";

export interface SalesCall {
  id: Identifier;
  businessId: Identifier;
  contactId: Identifier | null;
  direction: CallDirection;
  provider: string;
  providerCallId: string | null;
  providerMode: "REAL" | "DEMO";
  status: SalesCallStatus;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  outcome: SalesCallOutcome | null;
  language: SupportedSalesLanguage | null;
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface SalesMemory {
  id: Identifier;
  businessId: Identifier;
  summary: string;
  objections: string[];
  requirements: Record<string, unknown>;
  quotedPrice: number | null;
  agreedPrice: number | null;
  currency: CurrencyCode;
  dealStage: SalesState;
  nextAction: string | null;
  nextActionAt: ISODateString | null;
  lastContactId: Identifier | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type FollowUpType =
  | "OUTBOUND_CALL"
  | "AWAIT_INBOUND_CALL"
  | "WHATSAPP"
  | "EMAIL"
  | "HUMAN_TASK";

export type FollowUpStatus =
  | "SCHEDULED"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export interface FollowUp {
  id: Identifier;
  businessId: Identifier;
  contactId: Identifier | null;
  type: FollowUpType;
  scheduledAt: ISODateString;
  status: FollowUpStatus;
  reason: string;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: ISODateString | null;
  completedAt: ISODateString | null;
  dedupeKey: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type SalesEventType =
  | "LEAD_QUEUED"
  | "SALES_STATE_CHANGED"
  | "CALL_SCHEDULED"
  | "CALL_STARTED"
  | "CALL_CONNECTED"
  | "CALL_COMPLETED"
  | "CALL_FAILED"
  | "CONTACT_IDENTIFIED"
  | "CONTACT_CREATED"
  | "CONTACT_UPDATED"
  | "RECEPTIONIST_IDENTIFIED"
  | "OWNER_IDENTIFIED"
  | "OWNER_CONTACT_CREATED"
  | "CALLBACK_REQUESTED"
  | "FOLLOWUP_SCHEDULED"
  | "FOLLOWUP_COMPLETED"
  | "REQUIREMENT_CAPTURED"
  | "OBJECTION_RECORDED"
  | "QUOTE_CREATED"
  | "DEAL_WON"
  | "DEAL_LOST"
  | "DO_NOT_CONTACT"
  | "CRM_SYNC_QUEUED"
  | "CRM_SYNCED"
  | "CRM_SYNC_FAILED"
  | "SPEC_GENERATED"
  | "UNKNOWN_CALLER"
  | "JOB_RETRY_SCHEDULED"
  | "JOB_FAILED";

export interface SalesEvent {
  id: Identifier;
  businessId: Identifier;
  eventType: SalesEventType;
  metadata: Record<string, unknown>;
  correlationId: string | null;
  idempotencyKey: string;
  timestamp: ISODateString;
}

export type SalesJobType =
  | "PROCESS_LEAD"
  | "START_OUTBOUND_CALL"
  | "PROCESS_FOLLOW_UP"
  | "HANDLE_CALL_COMPLETION"
  | "SYNC_CRM"
  | "GENERATE_PROJECT_SPEC"
  | "TRIGGER_DEVELOPER"
  | "WORKFLOW_TASK";

export type SalesJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "RETRY_SCHEDULED"
  | "COMPLETED"
  | "FAILED"
  | "DEAD_LETTER"
  | "CANCELLED";

export interface SalesJob {
  id: Identifier;
  businessId: Identifier | null;
  type: SalesJobType;
  payload: Record<string, unknown>;
  status: SalesJobStatus;
  availableAt: ISODateString;
  attempts: number;
  maxAttempts: number;
  lockedAt: ISODateString | null;
  lockExpiresAt: ISODateString | null;
  lockedBy: string | null;
  lastError: string | null;
  dedupeKey: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** New five-agent jobs reuse the existing leased PostgreSQL job table. */
  workflowId?: string | null;
  agentType?: import("./workflow").CoreAgent;
}

export type CRMOutboxOperation =
  | "UPSERT_BUSINESS"
  | "UPSERT_CONTACT"
  | "SYNC_QUALIFICATION"
  | "SYNC_CALL"
  | "SYNC_FOLLOW_UP"
  | "SYNC_REQUIREMENTS"
  | "SYNC_QUOTE"
  | "SYNC_DEAL_STAGE"
  | "SYNC_BUILD_STATUS"
  | "SYNC_DEPLOYMENT";

export type CRMOutboxStatus =
  | "QUEUED"
  | "PROCESSING"
  | "RETRY_SCHEDULED"
  | "SYNCED"
  | "FAILED"
  | "DEAD_LETTER"
  | "CANCELLED";

export interface CRMOutboxItem {
  id: Identifier;
  businessId: Identifier;
  operation: CRMOutboxOperation;
  payload: Record<string, unknown>;
  status: CRMOutboxStatus;
  availableAt: ISODateString;
  attempts: number;
  maxAttempts: number;
  lockedAt: ISODateString | null;
  lockExpiresAt: ISODateString | null;
  lockedBy: string | null;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type SalesProjectSpecStatus = "READY" | "DISPATCHED" | "FAILED";

export interface SalesProjectSpecification {
  schemaVersion: 1;
  businessId: Identifier;
  business: {
    name: string;
    category: BusinessType;
    city: string;
    /** Explicitly approved public website contact; never inferred from the dial target. */
    phone: string;
  };
  contact: {
    id: Identifier | null;
    name: string | null;
    roles: ContactRole[];
    /** Customer-approved delivery address collected during the sales call. */
    email?: string | null;
  };
  requirements: {
    pages: string[];
    features: Record<string, boolean>;
    notes: string[];
  };
  branding: Record<string, unknown>;
  commercial: {
    quotedPrice: number | null;
    agreedPrice: number | null;
    currency: CurrencyCode;
  };
}

export interface SalesProjectSpec {
  id: Identifier;
  businessId: Identifier;
  contactId: Identifier | null;
  version: number;
  specification: SalesProjectSpecification;
  status: SalesProjectSpecStatus;
  idempotencyKey: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface SalesStateTransitionRecord {
  id: Identifier;
  businessId: Identifier;
  from: SalesState;
  to: SalesState;
  actor: string;
  reason: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: ISODateString;
}

export interface SalesBusinessDetail {
  business: SalesBusiness;
  contacts: Contact[];
  calls: SalesCall[];
  memory: SalesMemory | null;
  followUps: FollowUp[];
  events: SalesEvent[];
  transitions: SalesStateTransitionRecord[];
  projectSpec: SalesProjectSpec | null;
}

export interface SalesOverview {
  totalBusinesses: number;
  qualifiedBusinesses: number;
  callsQueued: number;
  callsAttempted: number;
  callsActive: number;
  receptionistContacts: number;
  decisionMakersIdentified: number;
  callbacksScheduled: number;
  negotiationsActive: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;
}
