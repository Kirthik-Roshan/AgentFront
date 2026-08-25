import { describe, expect, it } from "vitest";
import { IdempotentWorkerQueue } from "./queue";

describe("IdempotentWorkerQueue", () => {
  it("deduplicates jobs and retries bounded failures", async () => {
    let calls = 0;
    const queue = new IdempotentWorkerQueue(async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
    });
    const job = {
      id: "AF-2026-000001:run",
      leadId: "lead-AF-2026-000001",
      operation: "RUN_PIPELINE" as const,
      attempts: 0,
      maximumAttempts: 2,
      enqueuedAt: "2026-08-23T00:00:00.000Z",
    };
    expect(queue.enqueue(job)).toBe(true);
    expect(queue.enqueue(job)).toBe(false);
    await queue.drain();
    expect(calls).toBe(2);
    expect(queue.pendingCount).toBe(0);
  });
});
