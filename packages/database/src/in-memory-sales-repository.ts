import { assertSalesTransitionPath } from "@agentfront/orchestration";
import type { SalesChange, SalesListOptions, SalesRepository } from "@agentfront/orchestration";
import type {
  Business,
  Contact,
  CRMOutboxItem,
  FollowUp,
  SalesBusiness,
  SalesBusinessDetail,
  SalesJob,
} from "@agentfront/types";
import { demoBusinesses } from "./demo-data";

const clone = <T>(value: T): T => structuredClone(value);
const bounded = (limit: number): number => Math.max(0, Math.min(500, Math.floor(limit)));

function detailFor(business: SalesBusiness): SalesBusinessDetail {
  return {
    business: clone(business), contacts: [], calls: [], memory: null,
    followUps: [], events: [], transitions: [], projectSpec: null,
  };
}

function mergeById<T extends { id: string }>(existing: T[], changes: T[]): T[] {
  const result = new Map(existing.map((item) => [item.id, item]));
  for (const item of changes) result.set(item.id, clone(item));
  return [...result.values()];
}

function uniqueBy<T>(items: T[], key: (item: T) => string | null): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    if (seen.has(value)) throw new Error(`Duplicate sales idempotency key: ${value}`);
    seen.add(value);
  }
  return items;
}

export class InMemorySalesRepository implements SalesRepository {
  readonly #details = new Map<string, SalesBusinessDetail>();
  readonly #jobs = new Map<string, SalesJob>();
  readonly #outbox = new Map<string, CRMOutboxItem>();
  readonly #workerHeartbeats = new Map<string, string>();

  async recordWorkerHeartbeat(workerId: string, at: string): Promise<void> {
    if (!workerId.trim() || !Number.isFinite(Date.parse(at))) throw new TypeError("Valid worker heartbeat required.");
    this.#workerHeartbeats.set(workerId, new Date(at).toISOString());
  }

  async getLatestWorkerHeartbeat(): Promise<{ workerId: string; lastSeenAt: string } | null> {
    const entries = [...this.#workerHeartbeats.entries()].sort((a, b) => b[1].localeCompare(a[1]));
    return entries[0] ? { workerId: entries[0][0], lastSeenAt: entries[0][1] } : null;
  }

  constructor(options: { businesses?: Business[] } = {}) {
    for (const business of options.businesses ?? demoBusinesses) this.registerBusiness(business);
  }

  registerBusiness(business: Business): void {
    const previous = this.#details.get(business.id);
    const enriched: SalesBusiness = {
      ...clone(business),
      businessCode: business.businessCode ?? null,
      freshworksAccountId: previous?.business.freshworksAccountId ?? business.freshworksAccountId ?? null,
      freshworksDealId: previous?.business.freshworksDealId ?? business.freshworksDealId ?? null,
      salesState: previous?.business.salesState ?? "DISCOVERED",
      updatedAt: previous?.business.updatedAt ?? business.createdAt,
    };
    this.#details.set(business.id, previous ? { ...previous, business: enriched } : detailFor(enriched));
  }

  async getDetail(businessId: string): Promise<SalesBusinessDetail | null> {
    const detail = this.#details.get(businessId);
    return detail ? clone(detail) : null;
  }

  async list(options: SalesListOptions = {}): Promise<SalesBusinessDetail[]> {
    return [...this.#details.values()]
      .filter((detail) => !options.salesState || detail.business.salesState === options.salesState)
      .sort((a, b) => b.business.updatedAt.localeCompare(a.business.updatedAt))
      .slice(0, bounded(options.limit ?? 100))
      .map(clone);
  }

  async findContactsByPhone(normalizedPhone: string): Promise<Contact[]> {
    return [...this.#details.values()]
      .flatMap((detail) => detail.contacts)
      .filter((contact) => contact.normalizedPhone === normalizedPhone)
      .map(clone);
  }

  async applyChange(change: SalesChange): Promise<SalesBusinessDetail> {
    const original = this.#details.get(change.businessId);
    if (!original) throw new Error(`Sales business ${change.businessId} not found.`);
    if (change.expectedState && original.business.salesState !== change.expectedState) {
      throw new Error(`Sales state conflict: expected ${change.expectedState}, found ${original.business.salesState}.`);
    }
    const next = clone(original);
    for (const item of [
      ...(change.contacts ?? []), ...(change.calls ?? []), ...(change.followUps ?? []),
      ...(change.events ?? []), ...(change.transitions ?? []), ...(change.jobs ?? []),
      ...(change.outbox ?? []), ...(change.memory ? [change.memory] : []),
      ...(change.projectSpec ? [change.projectSpec] : []),
    ]) {
      if (item.businessId !== change.businessId) throw new Error("Cross-business sales write rejected.");
    }
    const merge = <T extends { id: string }>(current: T[], incoming: T[], key: (item: T) => string | null): T[] => {
      const combined = mergeById(current, incoming);
      return uniqueBy(combined, key);
    };
    next.contacts = merge(next.contacts, (change.contacts ?? []).map((item) => ({
      ...item,
      freshworksContactId: item.freshworksContactId ?? next.contacts.find((existing) => existing.id === item.id)?.freshworksContactId ?? null,
    })), (item) => item.dedupeKey);
    next.calls = merge(next.calls, change.calls ?? [], (item) => item.idempotencyKey);
    next.followUps = merge(next.followUps, change.followUps ?? [], (item) => item.dedupeKey);
    next.events = merge(next.events, change.events ?? [], (item) => item.idempotencyKey);
    next.transitions = merge(next.transitions, change.transitions ?? [], (item) => item.idempotencyKey);
    if (change.memory) next.memory = clone(change.memory);
    if (change.projectSpec) next.projectSpec = clone(change.projectSpec);
    const assertContact = (contactId: string | null) => {
      if (contactId && !next.contacts.some((item) => item.id === contactId)) {
        throw new Error("Cross-business contact reference rejected.");
      }
    };
    for (const item of change.calls ?? []) assertContact(item.contactId);
    for (const item of change.followUps ?? []) assertContact(item.contactId);
    if (change.memory) assertContact(change.memory.lastContactId);
    if (change.projectSpec) assertContact(change.projectSpec.contactId);
    for (const other of this.#details.values()) {
      if (other.business.id === change.businessId) continue;
      if (change.contacts?.some((item) => other.contacts.some((candidate) => candidate.id === item.id ||
        item.dedupeKey !== null && candidate.dedupeKey === item.dedupeKey))) throw new Error("Contact identity collision.");
      if (change.calls?.some((item) => other.calls.some((candidate) => candidate.id === item.id ||
        candidate.idempotencyKey === item.idempotencyKey))) throw new Error("Call identity collision.");
      if (change.followUps?.some((item) => other.followUps.some((candidate) => candidate.id === item.id ||
        candidate.dedupeKey === item.dedupeKey))) throw new Error("Follow-up identity collision.");
      if (change.events?.some((item) => other.events.some((candidate) => candidate.id === item.id ||
        candidate.idempotencyKey === item.idempotencyKey))) throw new Error("Sales event identity collision.");
      if (change.transitions?.some((item) => other.transitions.some((candidate) => candidate.id === item.id ||
        candidate.idempotencyKey === item.idempotencyKey))) throw new Error("Sales transition identity collision.");
    }
    assertSalesTransitionPath(next.business.salesState, change.nextState, change.transitions);
    if (change.nextState) next.business.salesState = change.nextState;
    const allJobs = new Map(this.#jobs);
    for (const job of change.jobs ?? []) {
      const sameKey = [...allJobs.values()].find((existing) => existing.dedupeKey === job.dedupeKey);
      if (sameKey) {
        if (sameKey.businessId !== job.businessId) throw new Error("Sales job dedupe key collision.");
      } else allJobs.set(job.id, clone(job));
    }
    const allOutbox = new Map(this.#outbox);
    for (const item of change.outbox ?? []) {
      const sameKey = [...allOutbox.values()].find((existing) => existing.idempotencyKey === item.idempotencyKey);
      if (sameKey) {
        if (sameKey.businessId !== item.businessId) throw new Error("CRM outbox idempotency key collision.");
      } else allOutbox.set(item.id, clone(item));
    }
    next.business.updatedAt = new Date().toISOString();
    this.#details.set(change.businessId, next);
    for (const item of allJobs.values()) this.#jobs.set(item.id, clone(item));
    for (const item of allOutbox.values()) this.#outbox.set(item.id, clone(item));
    return clone(next);
  }

  async listDueFollowUps(now: string, limit: number): Promise<FollowUp[]> {
    return [...this.#details.values()]
      .flatMap((detail) => detail.followUps)
      .filter((item) => item.status === "SCHEDULED" && item.scheduledAt <= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, bounded(limit)).map(clone);
  }

  async claimDueFollowUps(now: string, limit: number): Promise<FollowUp[]> {
    const staleBefore = new Date(Date.parse(now) - 15 * 60_000).toISOString();
    const due = [...this.#details.values()]
      .flatMap((detail) => detail.followUps)
      .filter((item) => item.type === "OUTBOUND_CALL" && item.attempts < item.maxAttempts && (
        item.status === "SCHEDULED" && item.scheduledAt <= now ||
        item.status === "PROCESSING" && item.lastAttemptAt !== null && item.lastAttemptAt <= staleBefore
      ))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, bounded(limit)).map(clone);
    for (const item of due) {
      const detail = this.#details.get(item.businessId)!;
      const current = detail.followUps.find((candidate) => candidate.id === item.id)!;
      current.status = "PROCESSING";
      current.attempts += 1;
      current.lastAttemptAt = now;
      current.updatedAt = now;
    }
    return due.map((item) => ({ ...item, status: "PROCESSING" as const, attempts: item.attempts + 1, lastAttemptAt: now, updatedAt: now }));
  }

  async enqueueJob(job: SalesJob): Promise<SalesJob> {
    const existing = [...this.#jobs.values()].find((item) => item.dedupeKey === job.dedupeKey);
    if (existing) return clone(existing);
    this.#jobs.set(job.id, clone(job));
    return clone(job);
  }

  async claimDueJobs(now: string, workerId: string, limit: number, leaseMs: number): Promise<SalesJob[]> {
    const claimed: SalesJob[] = [];
    for (const job of [...this.#jobs.values()].sort((a, b) => a.availableAt.localeCompare(b.availableAt))) {
      if (claimed.length >= bounded(limit)) break;
      if (!(["QUEUED", "RETRY_SCHEDULED"].includes(job.status) && job.availableAt <= now ||
        job.status === "PROCESSING" && job.lockExpiresAt !== null && job.lockExpiresAt <= now)) continue;
      job.status = "PROCESSING";
      job.attempts += 1;
      job.lockedAt = now;
      job.lockExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
      job.lockedBy = workerId;
      job.updatedAt = now;
      claimed.push(clone(job));
    }
    return claimed;
  }

  async renewJobLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "PROCESSING" || job.lockedBy !== workerId ||
        !job.lockExpiresAt || Date.parse(job.lockExpiresAt) <= Date.now()) return false;
    job.lockExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    job.updatedAt = new Date().toISOString();
    return true;
  }

  async completeJob(jobId: string, workerId: string): Promise<SalesJob> {
    const job = this.#ownedJob(jobId, workerId);
    job.status = "COMPLETED";
    job.lockedAt = null;
    job.lockExpiresAt = null;
    job.lockedBy = null;
    job.updatedAt = new Date().toISOString();
    return clone(job);
  }

  async retryJob(jobId: string, workerId: string, error: string, retryAt: string | null): Promise<SalesJob> {
    const job = this.#ownedJob(jobId, workerId);
    job.status = retryAt && job.attempts < job.maxAttempts ? "RETRY_SCHEDULED" : "DEAD_LETTER";
    if (job.status === "RETRY_SCHEDULED") job.availableAt = retryAt!;
    job.lastError = error.slice(0, 2_000);
    job.lockedAt = null;
    job.lockExpiresAt = null;
    job.lockedBy = null;
    job.updatedAt = new Date().toISOString();
    return clone(job);
  }

  async enqueueOutbox(item: CRMOutboxItem): Promise<CRMOutboxItem> {
    const existing = [...this.#outbox.values()].find((candidate) => candidate.idempotencyKey === item.idempotencyKey);
    if (existing) return clone(existing);
    this.#outbox.set(item.id, clone(item));
    return clone(item);
  }

  async claimDueOutbox(now: string, workerId: string, limit: number, leaseMs: number): Promise<CRMOutboxItem[]> {
    const claimed: CRMOutboxItem[] = [];
    for (const item of [...this.#outbox.values()].sort((a, b) => a.availableAt.localeCompare(b.availableAt))) {
      if (claimed.length >= bounded(limit)) break;
      if (!(["QUEUED", "RETRY_SCHEDULED"].includes(item.status) && item.availableAt <= now ||
        item.status === "PROCESSING" && item.lockExpiresAt !== null && item.lockExpiresAt <= now)) continue;
      item.status = "PROCESSING";
      item.attempts += 1;
      item.lockedAt = now;
      item.lockExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
      item.lockedBy = workerId;
      item.updatedAt = now;
      claimed.push(clone(item));
    }
    return claimed;
  }

  async completeOutbox(itemId: string, workerId: string): Promise<CRMOutboxItem> {
    const item = this.#ownedOutbox(itemId, workerId);
    item.status = "SYNCED";
    item.lastError = null;
    item.lockedAt = null;
    item.lockExpiresAt = null;
    item.lockedBy = null;
    item.updatedAt = new Date().toISOString();
    return clone(item);
  }

  async retryOutbox(itemId: string, workerId: string, error: string, retryAt: string | null): Promise<CRMOutboxItem> {
    const item = this.#ownedOutbox(itemId, workerId);
    item.status = retryAt && item.attempts < item.maxAttempts ? "RETRY_SCHEDULED" : "DEAD_LETTER";
    if (item.status === "RETRY_SCHEDULED") item.availableAt = retryAt!;
    item.lastError = error.slice(0, 2_000);
    item.lockedAt = null;
    item.lockExpiresAt = null;
    item.lockedBy = null;
    item.updatedAt = new Date().toISOString();
    return clone(item);
  }

  async setFreshworksAccountId(businessId: string, accountId: string): Promise<SalesBusinessDetail> {
    const detail = this.#details.get(businessId);
    const id = accountId.trim();
    if (!detail || !id || detail.business.freshworksAccountId && detail.business.freshworksAccountId !== id) {
      throw new Error("Freshworks account identity conflict or business not found.");
    }
    if ([...this.#details.values()].some((other) => other.business.id !== businessId && other.business.freshworksAccountId === id)) {
      throw new Error("Freshworks account identity collision.");
    }
    detail.business.freshworksAccountId = id;
    return clone(detail);
  }

  async setFreshworksDealId(businessId: string, dealId: string): Promise<SalesBusinessDetail> {
    const detail = this.#details.get(businessId);
    const id = dealId.trim();
    if (!detail || !id || detail.business.freshworksDealId && detail.business.freshworksDealId !== id) {
      throw new Error("Freshworks deal identity conflict or business not found.");
    }
    if ([...this.#details.values()].some((other) => other.business.id !== businessId && other.business.freshworksDealId === id)) {
      throw new Error("Freshworks deal identity collision.");
    }
    detail.business.freshworksDealId = id;
    return clone(detail);
  }

  async setFreshworksContactId(businessId: string, contactId: string, freshworksContactId: string): Promise<Contact> {
    const detail = this.#details.get(businessId);
    const contact = detail?.contacts.find((item) => item.id === contactId);
    const id = freshworksContactId.trim();
    if (!contact || !id || contact.freshworksContactId && contact.freshworksContactId !== id) {
      throw new Error("Freshworks contact identity conflict or contact not found for business.");
    }
    if ([...this.#details.values()].some((other) => other.contacts.some((item) => item.id !== contactId && item.freshworksContactId === id))) {
      throw new Error("Freshworks contact identity collision.");
    }
    contact.freshworksContactId = id;
    return clone(contact);
  }

  #ownedJob(jobId: string, workerId: string): SalesJob {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "PROCESSING" || job.lockedBy !== workerId) throw new Error("Sales job lease not owned.");
    return job;
  }

  #ownedOutbox(itemId: string, workerId: string): CRMOutboxItem {
    const item = this.#outbox.get(itemId);
    if (!item || item.status !== "PROCESSING" || item.lockedBy !== workerId) throw new Error("CRM outbox lease not owned.");
    return item;
  }
}
