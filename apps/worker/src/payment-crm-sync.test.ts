import { describe, expect, it, vi } from "vitest";
import type { DodoCrmSyncClaim } from "@agentfront/database";
import type { CRMProvider, LeadAggregate } from "@agentfront/types";
import {
  formatDodoTestPaymentNote,
  PaymentCrmSyncWorker,
  type PaymentCrmSyncRepository,
} from "./payment-crm-sync";

const claim: DodoCrmSyncClaim = {
  checkoutId: "checkout-row-1",
  leaseToken: "lease-token-1",
  projectId: "AF-2026-000001",
  paymentId: "pay_test_12345678",
  amountMinor: 720_000,
  currency: "INR",
  paidAt: "2026-09-21T08:30:00.000Z",
  attempt: 1,
};

function fixture(options: {
  mode?: "REAL" | "DEMO";
  healthStatus?: "CONNECTED" | "DEMO" | "DEGRADED";
  workflowDealId?: string | null;
  acceptedAmount?: number;
  addNoteError?: Error;
} = {}) {
  const mode = options.mode ?? "REAL";
  const healthStatus = options.healthStatus ?? (mode === "REAL" ? "CONNECTED" : "DEMO");
  const claimPendingCrmSync = vi.fn(async (): Promise<DodoCrmSyncClaim | null> => claim);
  const markCrmSynced = vi.fn(async (_checkoutId: string, _leaseToken: string) => true);
  const markCrmSyncFailed = vi.fn(async (_checkoutId: string, _leaseToken: string, _error: string) => true);
  const payments: PaymentCrmSyncRepository = { claimPendingCrmSync, markCrmSynced, markCrmSyncFailed };
  const findByProjectId = vi.fn(async () => ({
    lead: { projectId: claim.projectId, freshworksDealId: options.workflowDealId === undefined ? "deal-42" : options.workflowDealId },
    business: { id: "business-spiceroute", name: "SpiceRoute   Kitchen" },
    deal: { finalAmount: options.acceptedAmount ?? 7_200, currency: "INR" },
  } as unknown as LeadAggregate));
  const health = vi.fn(async () => ({
    integration: "crm" as const,
    provider: mode === "REAL" ? "Freshworks CRM" : "AgentFront Demo CRM",
    mode,
    status: healthStatus,
    message: "test health",
    checkedAt: "2026-09-21T08:31:00.000Z",
  }));
  const addNote = vi.fn(async (_dealId: string, _note: string) => {
    if (options.addNoteError) throw options.addNoteError;
  });
  const crm = {
    name: mode === "REAL" ? "Freshworks CRM" : "AgentFront Demo CRM",
    mode,
    health,
    addNote,
  } as unknown as CRMProvider;
  const worker = new PaymentCrmSyncWorker({
    payments,
    workflows: { findByProjectId },
    crm,
  });
  return {
    worker, claimPendingCrmSync, markCrmSynced, markCrmSyncFailed,
    findByProjectId, health, addNote,
  };
}

describe("Dodo test-payment Freshworks worker", () => {
  it("writes an explicitly test-only milestone before completing the database lease", async () => {
    const context = fixture();
    await expect(context.worker.pollOnce()).resolves.toEqual({
      claims: 1, synced: 1, failures: 0, skippedOverlap: false,
    });
    expect(context.health).toHaveBeenCalledTimes(1);
    expect(context.addNote).toHaveBeenCalledTimes(1);
    const [dealId, note] = context.addNote.mock.calls[0]!;
    expect(dealId).toBe("deal-42");
    expect(note).toContain("Dodo TEST payment webhook verified");
    expect(note).toContain("Sandbox transaction only; not live revenue");
    expect(note).toContain("INR 7200.00");
    expect(note).toContain(claim.paymentId);
    expect(note).toContain(claim.projectId);
    expect(context.markCrmSynced).toHaveBeenCalledWith(claim.checkoutId, claim.leaseToken);
    expect(context.addNote.mock.invocationCallOrder[0]).toBeLessThan(context.markCrmSynced.mock.invocationCallOrder[0]!);
    expect(context.markCrmSyncFailed).not.toHaveBeenCalled();
  });

  it("records a retry without touching a demo CRM", async () => {
    const context = fixture({ mode: "DEMO" });
    await expect(context.worker.pollOnce()).resolves.toMatchObject({ claims: 1, synced: 0, failures: 1 });
    expect(context.health).not.toHaveBeenCalled();
    expect(context.findByProjectId).not.toHaveBeenCalled();
    expect(context.addNote).not.toHaveBeenCalled();
    expect(context.markCrmSynced).not.toHaveBeenCalled();
    expect(context.markCrmSyncFailed).toHaveBeenCalledWith(
      claim.checkoutId, claim.leaseToken, expect.stringContaining("not in REAL mode"),
    );
  });

  it("records a retry when real Freshworks health is not connected", async () => {
    const context = fixture({ healthStatus: "DEGRADED" });
    await expect(context.worker.pollOnce()).resolves.toMatchObject({ claims: 1, synced: 0, failures: 1 });
    expect(context.health).toHaveBeenCalledTimes(1);
    expect(context.findByProjectId).not.toHaveBeenCalled();
    expect(context.addNote).not.toHaveBeenCalled();
    expect(context.markCrmSyncFailed).toHaveBeenCalledWith(
      claim.checkoutId, claim.leaseToken, expect.stringContaining("not connected (DEGRADED)"),
    );
  });

  it("never marks a payment synced when the real Freshworks write fails", async () => {
    const context = fixture({ addNoteError: new Error("Freshworks timeout api_key=secret-value") });
    await expect(context.worker.pollOnce()).resolves.toMatchObject({ claims: 1, synced: 0, failures: 1 });
    expect(context.markCrmSynced).not.toHaveBeenCalled();
    expect(context.markCrmSyncFailed).toHaveBeenCalledTimes(1);
    const storedError = context.markCrmSyncFailed.mock.calls[0]?.[2];
    expect(storedError).toContain("Freshworks timeout");
    expect(storedError).toContain("[REDACTED]");
    expect(storedError).not.toContain("secret-value");
  });

  it("does not write when the payment amount differs from its accepted deal", async () => {
    const context = fixture({ acceptedAmount: 7_000 });
    await expect(context.worker.pollOnce()).resolves.toMatchObject({ claims: 1, synced: 0, failures: 1 });
    expect(context.addNote).not.toHaveBeenCalled();
    expect(context.markCrmSynced).not.toHaveBeenCalled();
    expect(context.markCrmSyncFailed).toHaveBeenCalledWith(
      claim.checkoutId, claim.leaseToken, expect.stringContaining("accepted amount"),
    );
  });

  it("does nothing when there is no webhook-confirmed payment claim", async () => {
    const context = fixture();
    context.claimPendingCrmSync.mockResolvedValueOnce(null);
    await expect(context.worker.pollOnce()).resolves.toEqual({
      claims: 0, synced: 0, failures: 0, skippedOverlap: false,
    });
    expect(context.health).not.toHaveBeenCalled();
    expect(context.addNote).not.toHaveBeenCalled();
    expect(context.markCrmSynced).not.toHaveBeenCalled();
    expect(context.markCrmSyncFailed).not.toHaveBeenCalled();
  });

  it("normalizes the CRM note's display name and provider timestamp", () => {
    expect(formatDodoTestPaymentNote(claim, "  SpiceRoute\n Kitchen  ")).toContain(
      "SpiceRoute Kitchen (AF-2026-000001)",
    );
    expect(formatDodoTestPaymentNote(claim, "SpiceRoute Kitchen")).toContain(
      "Provider event time: 2026-09-21T08:30:00.000Z",
    );
  });
});
