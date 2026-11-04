import type {
  Contact,
  CRMOutboxItem,
  FollowUp,
  SalesBusinessDetail,
  SalesCall,
  SalesEvent,
  SalesJob,
  SalesMemory,
  SalesProjectSpec,
  SalesState,
  SalesStateTransitionRecord,
} from "@agentfront/types";

/** One business-scoped, durable commit. Every supplied entity must belong to businessId. */
export interface SalesChange {
  businessId: string;
  expectedState?: SalesState;
  nextState?: SalesState;
  contacts?: Contact[];
  calls?: SalesCall[];
  memory?: SalesMemory;
  followUps?: FollowUp[];
  events?: SalesEvent[];
  transitions?: SalesStateTransitionRecord[];
  projectSpec?: SalesProjectSpec;
  jobs?: SalesJob[];
  outbox?: CRMOutboxItem[];
}

export interface SalesListOptions {
  limit?: number;
  salesState?: SalesState;
}

export interface SalesWorkerHeartbeat {
  workerId: string;
  lastSeenAt: string;
}

/** Validates a single atomic commit that passes through several recorded states. */
export function assertSalesTransitionPath(
  current: SalesState,
  final: SalesState | undefined,
  transitions: readonly SalesStateTransitionRecord[] | undefined,
): void {
  if (!final || final === current) return;
  let cursor = current;
  for (const transition of transitions ?? []) {
    if (transition.from !== cursor) throw new Error(`Sales transition path is not contiguous at ${cursor}.`);
    cursor = transition.to;
  }
  if (cursor !== final) throw new Error("Sales state change requires a persisted transition path.");
}

export interface SalesRepository {
  recordWorkerHeartbeat(workerId: string, at: string): Promise<void>;
  getLatestWorkerHeartbeat(): Promise<SalesWorkerHeartbeat | null>;
  getDetail(businessId: string): Promise<SalesBusinessDetail | null>;
  list(options?: SalesListOptions): Promise<SalesBusinessDetail[]>;
  findContactsByPhone(normalizedPhone: string): Promise<Contact[]>;
  applyChange(change: SalesChange): Promise<SalesBusinessDetail>;
  listDueFollowUps(now: string, limit: number): Promise<FollowUp[]>;
  claimDueFollowUps(now: string, limit: number): Promise<FollowUp[]>;
  enqueueJob(job: SalesJob): Promise<SalesJob>;
  claimDueJobs(now: string, workerId: string, limit: number, leaseMs: number): Promise<SalesJob[]>;
  renewJobLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  completeJob(jobId: string, workerId: string): Promise<SalesJob>;
  retryJob(jobId: string, workerId: string, error: string, retryAt: string | null): Promise<SalesJob>;
  enqueueOutbox(item: CRMOutboxItem): Promise<CRMOutboxItem>;
  claimDueOutbox(now: string, workerId: string, limit: number, leaseMs: number): Promise<CRMOutboxItem[]>;
  completeOutbox(itemId: string, workerId: string): Promise<CRMOutboxItem>;
  retryOutbox(itemId: string, workerId: string, error: string, retryAt: string | null): Promise<CRMOutboxItem>;
  setFreshworksAccountId(businessId: string, accountId: string): Promise<SalesBusinessDetail>;
  setFreshworksDealId(businessId: string, dealId: string): Promise<SalesBusinessDetail>;
  setFreshworksContactId(businessId: string, contactId: string, freshworksContactId: string): Promise<Contact>;
}
