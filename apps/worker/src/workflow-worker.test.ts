import { describe, expect, it, vi } from "vitest";
import type { ControlTowerRepository } from "@agentfront/orchestration";
import type { SalesJob } from "@agentfront/types";
import { WorkflowWorker } from "./workflow-worker";

const timestamp = new Date().toISOString();
const fixture = (attempts = 1, maxAttempts = 2): SalesJob => ({
  id: "workflow-job-1", workflowId: "workflow-business-1", businessId: "business-1", agentType: "DISCOVER",
  type: "WORKFLOW_TASK", payload: { task: "DISCOVER_TERRITORY" }, status: "PROCESSING",
  availableAt: timestamp, attempts, maxAttempts, lockedAt: timestamp,
  lockExpiresAt: new Date(Date.now() + 60_000).toISOString(), lockedBy: "test-worker", lastError: null,
  dedupeKey: "discover-1", createdAt: timestamp, updatedAt: timestamp,
});

function setup(job: SalesJob | null = fixture(), stopped = false) {
  const repository = {
    emergencyStopped: vi.fn(async () => stopped),
    claim: vi.fn(async () => job ? [job] : []),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } as unknown as ControlTowerRepository;
  return repository;
}

describe("shared five-agent worker base", () => {
  it("never claims work when the persisted emergency stop is active", async () => {
    const repository = setup(fixture(), true);
    const handler = vi.fn(async () => {});
    const worker = new WorkflowWorker({ repository, workerId: "test-worker", handlers: { DISCOVER: handler } });
    expect(await worker.pollOnce()).toBe(0);
    expect(repository.claim).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("acknowledges a single claimed business-scoped task", async () => {
    const repository = setup();
    const handler = vi.fn(async (_job: SalesJob, context: { businessId: string; workflowId: string }) => {
      expect(context).toMatchObject({ businessId: "business-1", workflowId: "workflow-business-1" });
    });
    const worker = new WorkflowWorker({ repository, workerId: "test-worker", handlers: { DISCOVER: handler } });
    expect(await worker.pollOnce()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(repository.claim).toHaveBeenCalledWith("test-worker", 5 * 60_000, 1);
    expect(repository.complete).toHaveBeenCalledWith("workflow-job-1", "test-worker");
  });

  it("bounds retries and lets a dead-lettered job settle without blocking another business", async () => {
    const repository = setup(fixture(2, 2));
    const worker = new WorkflowWorker({ repository, workerId: "test-worker", handlers: {
      DISCOVER: async () => { throw new Error("Provider unavailable."); },
    } });
    expect(await worker.pollOnce()).toBe(0);
    expect(repository.fail).toHaveBeenCalledWith("workflow-job-1", "test-worker", "Provider unavailable.", null);
  });

  it("rejects a second overlapping tick while the first task is in flight", async () => {
    const repository = setup();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const worker = new WorkflowWorker({ repository, workerId: "test-worker", handlers: { DISCOVER: async () => blocker } });
    const pending = worker.pollOnce();
    expect(await worker.pollOnce()).toBe(0);
    release();
    expect(await pending).toBe(1);
    expect(repository.claim).toHaveBeenCalledTimes(1);
  });
});
