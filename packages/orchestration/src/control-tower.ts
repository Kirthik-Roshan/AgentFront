import type { AgentRun, BusinessWorkflow, CoreAgent, EnqueueWorkflowJob, WorkflowEvent, WorkflowEventType } from "@agentfront/types";
import type { SalesJob } from "@agentfront/types";

export interface AppendWorkflowEvent {
  businessId: string;
  sourceAgent: CoreAgent;
  eventType: WorkflowEventType;
  idempotencyKey: string;
  message: string;
  payload?: Record<string, unknown>;
  status?: WorkflowEvent["status"];
  correlationId?: string;
  retryCount?: number;
  nextJob?: Omit<EnqueueWorkflowJob, "workflowId" | "businessId">;
}

/** The event append and downstream job creation must be one durable transaction. */
export interface ControlTowerRepository {
  append(input: AppendWorkflowEvent): Promise<{ workflow: BusinessWorkflow; event: WorkflowEvent; job: SalesJob | null }>;
  listWorkflows(limit?: number): Promise<BusinessWorkflow[]>;
  listAgentRuns(limit?: number): Promise<AgentRun[]>;
  recentEvents(limit?: number): Promise<WorkflowEvent[]>;
  eventsAfter(cursor: string | null, limit?: number): Promise<WorkflowEvent[]>;
  claim(workerId: string, leaseMs: number, limit?: number): Promise<SalesJob[]>;
  renew(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  complete(jobId: string, workerId: string): Promise<void>;
  fail(jobId: string, workerId: string, error: string, retryAt: string | null): Promise<void>;
  emergencyStopped(): Promise<boolean>;
  setEmergencyStop(stopped: boolean): Promise<void>;
}
