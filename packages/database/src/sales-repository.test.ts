import { describe, expect, it } from "vitest";
import type {
  Contact, CRMOutboxItem, FollowUp, SalesEvent, SalesJob, SalesStateTransitionRecord,
} from "@agentfront/types";
import { demoBusinesses } from "./demo-data";
import { InMemorySalesRepository } from "./in-memory-sales-repository";

const now = "2026-09-19T09:00:00.000Z";
const business = demoBusinesses[0]!;

function contact(id: string, phone: string, role: Contact["roles"][number]): Contact {
  return {
    id, businessId: business.id, name: role === "OWNER" ? "Raj" : "Reception",
    phone, normalizedPhone: phone, roles: [role], isDecisionMaker: role === "OWNER",
    preferredLanguage: "TAMIL", source: role === "OWNER" ? "RECEPTIONIST_REFERRAL" : "PUBLIC_LISTING",
    verified: true, dedupeKey: `${business.id}:${phone}`, createdAt: now, updatedAt: now,
  };
}

function transition(id: string, from: SalesStateTransitionRecord["from"], to: SalesStateTransitionRecord["to"]): SalesStateTransitionRecord {
  return {
    id, businessId: business.id, from, to, actor: "TEST", reason: "Test transition",
    idempotencyKey: id, metadata: {}, createdAt: now,
  };
}

function event(id: string): SalesEvent {
  return { id, businessId: business.id, eventType: "CONTACT_CREATED", metadata: {}, correlationId: null, idempotencyKey: id, timestamp: now };
}

function followUp(id: string): FollowUp {
  return {
    id, businessId: business.id, contactId: "owner-1", type: "OUTBOUND_CALL",
    scheduledAt: now, status: "SCHEDULED", reason: "Owner requested callback",
    attempts: 0, maxAttempts: 3, lastAttemptAt: null, completedAt: null,
    dedupeKey: id, createdAt: now, updatedAt: now,
  };
}

function job(id: string): SalesJob {
  return {
    id, businessId: business.id, type: "PROCESS_FOLLOW_UP", payload: { followUpId: "follow-1" },
    status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 2,
    lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
    dedupeKey: id, createdAt: now, updatedAt: now,
  };
}

function outbox(id: string): CRMOutboxItem {
  return {
    id, businessId: business.id, operation: "UPSERT_CONTACT", payload: { contactId: "owner-1" },
    status: "QUEUED", availableAt: now, attempts: 0, maxAttempts: 2,
    lockedAt: null, lockExpiresAt: null, lockedBy: null, lastError: null,
    idempotencyKey: id, createdAt: now, updatedAt: now,
  };
}

describe("InMemorySalesRepository", () => {
  it("reports the newest worker heartbeat without implying that the API runs the worker", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    expect(await repo.getLatestWorkerHeartbeat()).toBeNull();
    await repo.recordWorkerHeartbeat("worker-a", "2026-09-19T08:59:00.000Z");
    await repo.recordWorkerHeartbeat("worker-b", now);
    expect(await repo.getLatestWorkerHeartbeat()).toEqual({ workerId: "worker-b", lastSeenAt: now });
  });
  it("keeps Freshworks IDs durable across contact updates and rejects remapping", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    await repo.applyChange({ businessId: business.id, contacts: [contact("owner-1", "+919876543210", "OWNER")] });
    expect((await repo.setFreshworksAccountId(business.id, "account-123")).business.freshworksAccountId).toBe("account-123");
    expect((await repo.setFreshworksDealId(business.id, "deal-456")).business.freshworksDealId).toBe("deal-456");
    expect((await repo.setFreshworksContactId(business.id, "owner-1", "contact-789")).freshworksContactId).toBe("contact-789");
    await repo.applyChange({ businessId: business.id, contacts: [contact("owner-1", "+919876543210", "OWNER")] });
    expect((await repo.getDetail(business.id))?.contacts[0]?.freshworksContactId).toBe("contact-789");
    expect((await repo.setFreshworksAccountId(business.id, "account-123")).business.freshworksAccountId).toBe("account-123");
    await expect(repo.setFreshworksAccountId(business.id, "account-other")).rejects.toThrow("conflict");
    await expect(repo.setFreshworksDealId(business.id, "deal-other")).rejects.toThrow("conflict");
    await expect(repo.setFreshworksContactId(business.id, "owner-1", "contact-other")).rejects.toThrow("conflict");
  });

  it("keeps receptionist and owner attached to the same durable business", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    const first = await repo.applyChange({
      businessId: business.id, expectedState: "DISCOVERED", nextState: "RECEPTIONIST_CONTACTED",
      contacts: [contact("reception-1", "+914422220000", "RECEPTIONIST")],
      transitions: [transition("transition-1", "DISCOVERED", "RECEPTIONIST_CONTACTED")],
      events: [event("event-1")],
    });
    expect(first.business.id).toBe(business.id);
    const second = await repo.applyChange({
      businessId: business.id, expectedState: "RECEPTIONIST_CONTACTED", nextState: "OWNER_CONTACT_IDENTIFIED",
      contacts: [contact("owner-1", "+919876543210", "OWNER")],
      transitions: [transition("transition-2", "RECEPTIONIST_CONTACTED", "OWNER_CONTACT_IDENTIFIED")],
      followUps: [followUp("follow-1")],
    });
    expect(second.contacts).toHaveLength(2);
    expect(second.contacts.every((item) => item.businessId === business.id)).toBe(true);
    expect((await repo.findContactsByPhone("+919876543210"))[0]?.id).toBe("owner-1");
    expect((await repo.listDueFollowUps(now, 10))[0]?.contactId).toBe("owner-1");
    expect((await repo.claimDueFollowUps(now, 10))[0]?.status).toBe("PROCESSING");
    expect(await repo.claimDueFollowUps(now, 10)).toEqual([]);
  });

  it("does not consume an awaiting-inbound callback as an outbound worker job", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    await repo.applyChange({ businessId: business.id, followUps: [{ ...followUp("await-owner"), contactId: null, type: "AWAIT_INBOUND_CALL" }] });
    expect(await repo.listDueFollowUps(now, 10)).toHaveLength(1);
    expect(await repo.claimDueFollowUps(now, 10)).toEqual([]);
    expect((await repo.getDetail(business.id))?.followUps[0]?.status).toBe("SCHEDULED");
  });

  it("rejects conflicting transitions without partial writes", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    await expect(repo.applyChange({
      businessId: business.id, expectedState: "QUALIFIED", nextState: "CALL_PENDING",
      contacts: [contact("owner-1", "+919876543210", "OWNER")],
      transitions: [transition("transition-1", "QUALIFIED", "CALL_PENDING")],
    })).rejects.toThrow("Sales state conflict");
    expect((await repo.getDetail(business.id))?.contacts).toEqual([]);
    await expect(repo.applyChange({ businessId: business.id, nextState: "CALL_PENDING" })).rejects.toThrow("requires a persisted transition path");
  });

  it("commits an ordered multi-step sales path atomically", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    const result = await repo.applyChange({
      businessId: business.id, expectedState: "DISCOVERED", nextState: "FOLLOW_UP_SCHEDULED",
      transitions: [
        transition("multi-1", "DISCOVERED", "QUALIFIED"),
        transition("multi-2", "QUALIFIED", "CALL_PENDING"),
        transition("multi-3", "CALL_PENDING", "FOLLOW_UP_SCHEDULED"),
      ],
    });
    expect(result.business.salesState).toBe("FOLLOW_UP_SCHEDULED");
    expect(result.transitions).toHaveLength(3);
    await expect(repo.applyChange({
      businessId: business.id, nextState: "OWNER_CONTACTED",
      transitions: [transition("bad-1", "QUALIFIED", "OWNER_CONTACTED")],
    })).rejects.toThrow("not contiguous");
    expect((await repo.getDetail(business.id))?.business.salesState).toBe("FOLLOW_UP_SCHEDULED");
  });

  it("deduplicates, leases, retries and dead-letters jobs and outbox items", async () => {
    const repo = new InMemorySalesRepository({ businesses: [business] });
    expect((await repo.enqueueJob(job("job-1"))).id).toBe("job-1");
    expect((await repo.enqueueJob({ ...job("job-2"), dedupeKey: "job-1" })).id).toBe("job-1");
    expect((await repo.claimDueJobs(now, "worker-a", 10, 60_000))[0]?.attempts).toBe(1);
    expect(await repo.claimDueJobs(now, "worker-b", 10, 60_000)).toEqual([]);
    await expect(repo.completeJob("job-1", "worker-b")).rejects.toThrow("lease not owned");
    expect((await repo.retryJob("job-1", "worker-a", "network unavailable", "2026-09-19T09:02:00.000Z")).status).toBe("RETRY_SCHEDULED");
    await repo.claimDueJobs("2026-09-19T09:02:00.000Z", "worker-b", 10, 60_000);
    expect((await repo.retryJob("job-1", "worker-b", "network unavailable", "2026-09-19T09:04:00.000Z")).status).toBe("DEAD_LETTER");

    expect((await repo.enqueueOutbox(outbox("outbox-1"))).id).toBe("outbox-1");
    expect((await repo.claimDueOutbox(now, "worker-a", 10, 60_000))[0]?.status).toBe("PROCESSING");
    expect((await repo.completeOutbox("outbox-1", "worker-a")).status).toBe("SYNCED");
  });
});
