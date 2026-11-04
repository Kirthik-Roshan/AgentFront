import type { AgentEvent, ISODateString } from "./domain";

/** Product roles. Historical pipeline stage actors remain on AgentEvent for compatibility. */
export const CORE_AGENTS = ["DISCOVER", "SALES", "DEVELOPER", "ADVERTISEMENT", "DELIVERY"] as const;
export type CoreAgent = (typeof CORE_AGENTS)[number];

export const WORKFLOW_EVENT_TYPES = [
  "BUSINESS_DISCOVERED", "LEAD_CREATED", "SALES_CALL_REQUESTED", "SALES_CALL_STARTED",
  "SALES_CALL_COMPLETED", "CALLBACK_REQUIRED", "DEAL_WON", "DEAL_LOST",
  "REQUIREMENTS_READY", "BUILD_REQUESTED", "BUILD_STARTED", "REPOSITORY_CREATED",
  "TEMPLATE_SELECTED", "CODE_GENERATION_STARTED", "CODE_GENERATION_COMPLETED",
  "BUILD_VALIDATION_STARTED", "BUILD_FAILED", "BUILD_SUCCESS", "DEPLOYMENT_STARTED",
  "DEPLOYMENT_SUCCESS", "DEPLOYMENT_FAILED", "ADVERTISEMENT_REQUESTED",
  "ADVERTISEMENT_CREATED", "ADVERTISEMENT_ACTIVE", "ADVERTISEMENT_FAILED",
  "DELIVERY_REQUESTED", "PAYMENT_LINK_CREATED", "PAYMENT_PENDING", "PAYMENT_SUCCESS",
  "PAYMENT_FAILED", "CLIENT_DELIVERED", "WORKFLOW_COMPLETED",
  /** Transitional command until the existing stage executor is split into five handlers. */
  "PIPELINE_CONTINUATION_REQUESTED",
] as const;
export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];
export type WorkflowStatus = "IDLE" | "ACTIVE" | "PAUSED" | "FAILED" | "COMPLETED";
export type AgentRunStatus = "RUNNING" | "SUCCEEDED" | "RETRY_SCHEDULED" | "FAILED";

export interface BusinessWorkflow {
  id: string;
  businessId: string;
  correlationId: string;
  status: WorkflowStatus;
  currentAgent: CoreAgent | null;
  currentTask: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  completedAt: ISODateString | null;
}

/** The existing AgentEvent table is the single persisted control-tower event ledger. */
export interface WorkflowEvent extends AgentEvent {
  businessId: string;
  workflowId: string;
  correlationId: string;
  sourceAgent: CoreAgent;
  eventType: WorkflowEventType;
  retryCount: number;
  payload: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  workflowId: string;
  businessId: string;
  jobId: string;
  agentType: CoreAgent;
  status: AgentRunStatus;
  retryCount: number;
  provider: string | null;
  externalId: string | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: ISODateString;
  completedAt: ISODateString | null;
}

export interface EnqueueWorkflowJob {
  workflowId: string;
  businessId: string;
  agentType: CoreAgent;
  type: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  availableAt?: ISODateString;
  maxAttempts?: number;
}
