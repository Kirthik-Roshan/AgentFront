import type {
  AgentEvent,
  BusinessType,
  Campaign,
  DashboardMetrics,
  LeadAggregate,
  PipelineState,
} from "./domain";
import type { PlacesSearchRequest } from "./providers";
import type { CRMDealSummary } from "./providers";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResponse<T> =
  | { ok: true; data: T; meta?: Record<string, unknown> }
  | { ok: false; error: ApiError };

export interface DiscoveryQuery extends PlacesSearchRequest {
  campaignId?: string;
}

export interface StartPipelineRequest {
  businessId: string;
  campaignId: string;
  idempotencyKey: string;
}

export interface AdvancePipelineRequest {
  targetState?: PipelineState;
  idempotencyKey: string;
}

export interface CompleteConversationRequest {
  acceptedAmount?: number;
  idempotencyKey: string;
}

export interface ApiRouteContract {
  "GET /api/health": ApiResponse<{ service: "agentfront-api"; status: "ok"; checkedAt: string }>;
  "GET /api/dashboard": ApiResponse<DashboardProjection>;
  "GET /api/crm/deals": ApiResponse<CRMBoardProjection>;
  "GET /api/leads/:id": ApiResponse<LeadAggregate>;
  "POST /api/pipeline/start": ApiResponse<LeadAggregate>;
}

export interface CRMBoardProjection {
  mode: "REAL" | "DEMO";
  provider: string;
  consoleUrl: string | null;
  deals: CRMDealSummary[];
}

export interface DashboardProjection {
  metrics: DashboardMetrics;
  campaigns: Campaign[];
  leads: LeadAggregate[];
  events: AgentEvent[];
}

export interface EventStreamMessage {
  id: string;
  event: "agent-event" | "pipeline-transition" | "heartbeat";
  data: AgentEvent | Record<string, unknown>;
}

export interface AnalyticsBreakdown {
  byIndustry: Record<BusinessType, { leads: number; dealsWon: number; revenue: number }>;
  funnel: Array<{ state: PipelineState; count: number }>;
}
