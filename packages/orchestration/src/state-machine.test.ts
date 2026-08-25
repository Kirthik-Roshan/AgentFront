import { describe, expect, it } from "vitest";
import { IdempotencyConflictError, InvalidPipelineTransitionError, PipelineStateMachine } from "./state-machine";

const base = {
  leadId: "lead-AF-2026-000001",
  projectId: "AF-2026-000001",
  currentState: "DISCOVERED" as const,
  targetState: "QUALIFIED" as const,
  actor: "QUALIFICATION" as const,
  reason: "Scored 91/100.",
  idempotencyKey: "AF-2026-000001:qualification",
  at: "2026-08-23T00:00:00.000Z",
};

describe("PipelineStateMachine", () => {
  it("records an append-only transition and replays the same idempotency key", () => {
    const machine = new PipelineStateMachine();
    const first = machine.transition(base, []);
    const replay = machine.transition(base, [first.transition]);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.transition).toEqual(first.transition);
  });

  it("rejects skipped lifecycle stages", () => {
    const machine = new PipelineStateMachine();
    expect(() => machine.transition({ ...base, targetState: "DEAL_WON" }, [])).toThrow(
      InvalidPipelineTransitionError,
    );
  });

  it("rejects reuse of an idempotency key for a different command", () => {
    const machine = new PipelineStateMachine();
    const first = machine.transition(base, []);
    expect(() =>
      machine.transition({ ...base, targetState: "REJECTED" }, [first.transition]),
    ).toThrow(IdempotencyConflictError);
  });
});
