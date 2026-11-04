import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalJobQueue, LocalScheduler, type EnqueueSalesJobInput } from "./sales-jobs";

const initialTime = "2026-09-19T04:00:00.000Z";

const jobInput = (dedupeKey: string, overrides: Partial<EnqueueSalesJobInput> = {}): EnqueueSalesJobInput => ({
  businessId: "business-spice-garden",
  type: "PROCESS_FOLLOW_UP",
  payload: { contactId: "contact-owner-1" },
  dedupeKey,
  ...overrides,
});

describe("LocalJobQueue", () => {
  it("replays an identical enqueue after time advances without losing the first schedule", async () => {
    let now = new Date(initialTime);
    const queue = new LocalJobQueue({ clock: () => now });
    const first = await queue.enqueue(jobInput("follow-up:1"));
    now = new Date("2026-09-19T04:05:00.000Z");
    const replay = await queue.enqueue(jobInput("follow-up:1"));

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ job: first.job, replayed: true });
    expect(await queue.list()).toHaveLength(1);
    expect(first.job.availableAt).toBe(initialTime);
    expect(first.job.lockedBy).toBeNull();
    expect((await queue.health()).status).toBe("DEMO");
    expect((await queue.health()).message).toContain("not durable");
    await expect(queue.enqueue(jobInput("follow-up:1", {
      payload: { contactId: "different-contact" },
    }))).rejects.toThrow(/conflicts/);
  });

  it("runs only due jobs in schedule order and honours the per-pass limit", async () => {
    let now = new Date(initialTime);
    const queue = new LocalJobQueue({ clock: () => now });
    await queue.enqueue(jobInput("later", { availableAt: "2026-09-19T04:20:00.000Z" }));
    await queue.enqueue(jobInput("first"));
    await queue.enqueue(jobInput("second"));
    const called: string[] = [];
    const handler = async (job: { dedupeKey: string }) => { called.push(job.dedupeKey); };

    expect((await queue.processDue(handler, 1)).map((item) => item.outcome)).toEqual(["SUCCEEDED"]);
    expect(called).toEqual(["first"]);
    expect((await queue.processDue(handler)).map((item) => item.outcome)).toEqual(["SUCCEEDED"]);
    expect(called).toEqual(["first", "second"]);
    now = new Date("2026-09-19T04:20:00.000Z");
    await queue.processDue(handler);
    expect(called).toEqual(["first", "second", "later"]);
  });

  it("retries with capped exponential delay, redacts errors, and dead-letters after the limit", async () => {
    let now = new Date(initialTime);
    const queue = new LocalJobQueue({
      clock: () => now,
      baseRetryDelayMs: 1_000,
      maximumRetryDelayMs: 1_500,
    });
    const { job } = await queue.enqueue(jobInput("retry", { maxAttempts: 3 }));
    const fail = async () => { throw new Error("API_KEY=private-key call failed"); };

    const first = await queue.processDue(fail);
    expect(first[0]?.outcome).toBe("RETRY_SCHEDULED");
    expect(first[0]?.job.availableAt).toBe("2026-09-19T04:00:01.000Z");
    expect(first[0]?.error).toContain("[REDACTED]");
    expect(first[0]?.error).not.toContain("private-key");
    expect(await queue.processDue(fail)).toEqual([]);

    now = new Date("2026-09-19T04:00:01.000Z");
    const second = await queue.processDue(fail);
    expect(second[0]?.job.availableAt).toBe("2026-09-19T04:00:02.500Z");
    now = new Date("2026-09-19T04:00:02.500Z");
    const third = await queue.processDue(fail);
    expect(third[0]?.outcome).toBe("DEAD_LETTER");
    expect(third[0]?.job.attempts).toBe(3);
    expect((await queue.get(job.id))?.status).toBe("DEAD_LETTER");
    expect((await queue.health()).message).toContain("1 dead-letter");
    expect(await queue.processDue(fail)).toEqual([]);
  });

  it("does not process a queued job cancelled by an earlier handler", async () => {
    const queue = new LocalJobQueue({ clock: () => new Date(initialTime) });
    await queue.enqueue(jobInput("first"));
    const second = await queue.enqueue(jobInput("second"));
    const called: string[] = [];
    const results = await queue.processDue(async (job) => {
      called.push(job.dedupeKey);
      await queue.cancel(second.job.id);
    });

    expect(called).toEqual(["first"]);
    expect(results).toHaveLength(1);
    expect((await queue.get(second.job.id))?.status).toBe("CANCELLED");
  });

  it("does not double-run overlapping polls or falsely cancel in-flight work", async () => {
    const queue = new LocalJobQueue({ clock: () => new Date(initialTime) });
    const { job } = await queue.enqueue(jobInput("active"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn(async () => { await gate; });
    const first = queue.processDue(handler);

    expect((await queue.get(job.id))?.status).toBe("PROCESSING");
    expect(await queue.processDue(handler)).toEqual([]);
    expect((await queue.cancel(job.id))?.status).toBe("PROCESSING");
    release();
    expect((await first)[0]?.outcome).toBe("SUCCEEDED");
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await queue.get(job.id))?.status).toBe("COMPLETED");
  });

  it("rejects ambiguous schedules and invalid retry limits", async () => {
    const queue = new LocalJobQueue({ clock: () => new Date(initialTime) });
    await expect(queue.enqueue(jobInput("bad-date", { availableAt: "tomorrow" }))).rejects.toThrow(/ISO 8601/);
    await expect(queue.enqueue(jobInput("bad-attempts", { maxAttempts: 0 }))).rejects.toThrow(/positive integer/);
    await expect(queue.processDue(async () => {}, 0)).rejects.toThrow(/positive integer/);
  });
});

describe("LocalScheduler", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("polls on a local timer, stops cleanly, and reports demo-only durability", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(initialTime));
    const processDue = vi.fn(async () => 2);
    const scheduler = new LocalScheduler({ processDue, intervalMs: 1_000 });
    expect(scheduler.running).toBe(false);
    expect((await scheduler.health()).status).toBe("DEMO");
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(processDue).toHaveBeenCalledTimes(2);
    expect(scheduler.running).toBe(true);
    expect((await scheduler.health()).message).toContain("not durable");
    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(processDue).toHaveBeenCalledTimes(2);
    expect(scheduler.running).toBe(false);
  });

  it("skips overlapping ticks and recovers health after a later success", async () => {
    let release!: (value: number) => void;
    const gate = new Promise<number>((resolve) => { release = resolve; });
    const processDue = vi.fn()
      .mockImplementationOnce(async () => gate)
      .mockImplementationOnce(async () => { throw new Error("token=secret-value"); })
      .mockImplementationOnce(async () => 3);
    const scheduler = new LocalScheduler({
      processDue,
      clock: () => new Date(initialTime),
    });
    const first = scheduler.tick();
    expect((await scheduler.tick()).status).toBe("SKIPPED_OVERLAP");
    expect(processDue).toHaveBeenCalledTimes(1);
    release(1);
    expect(await first).toMatchObject({ status: "COMPLETED", processed: 1 });

    const failed = await scheduler.tick();
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("[REDACTED]");
    expect(failed.error).not.toContain("secret-value");
    expect((await scheduler.health()).status).toBe("DEGRADED");

    expect(await scheduler.tick()).toMatchObject({ status: "COMPLETED", processed: 3 });
    expect((await scheduler.health()).status).toBe("DEMO");
  });

  it("reports an invalid worker count as a failed tick", async () => {
    const scheduler = new LocalScheduler({ processDue: async () => -1 });
    expect(await scheduler.tick()).toMatchObject({ status: "FAILED", processed: 0 });
    expect((await scheduler.health()).status).toBe("DEGRADED");
  });
});
