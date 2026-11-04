import { describe, expect, it } from "vitest";
import type { SalesState } from "@agentfront/types";
import {
  InvalidSalesTransitionError,
  SalesStateMachine,
  SalesTransitionIdempotencyConflictError,
  type SalesTransition,
} from "./sales-state-machine";

const businessId = "business-spice-garden";

describe("SalesStateMachine", () => {
  it("persists a realistic receptionist-to-owner-to-won journey", () => {
    const machine = new SalesStateMachine();
    const history: SalesTransition[] = [];
    let current: SalesState = "DISCOVERED";
    const journey: SalesState[] = [
      "QUALIFIED",
      "CALL_PENDING",
      "CALLING",
      "CONTACTED",
      "RECEPTIONIST_CONTACTED",
      "DECISION_MAKER_REQUIRED",
      "OWNER_CONTACT_IDENTIFIED",
      "CALLBACK_REQUESTED",
      "FOLLOW_UP_SCHEDULED",
      "OWNER_CONTACTED",
      "DISCOVERY_CONVERSATION",
      "REQUIREMENTS_COLLECTING",
      "NEGOTIATING",
      "QUOTE_PRESENTED",
      "DEAL_WON",
      "SPEC_GENERATED",
      "BUILD_PENDING",
      "BUILDING",
      "QA",
      "DEPLOYING",
      "DEPLOYED",
    ];

    for (const [index, targetState] of journey.entries()) {
      const result = machine.transition({
        businessId,
        currentState: current,
        targetState,
        actor: targetState === "FOLLOW_UP_SCHEDULED" ? "SCHEDULER" : "SALES_ORCHESTRATOR",
        reason: `Advance to ${targetState}.`,
        idempotencyKey: `${businessId}:${index + 1}:${targetState}`,
        at: new Date(Date.UTC(2026, 8, 18, 4, index)).toISOString(),
      }, history);
      expect(result.replayed).toBe(false);
      history.push(result.transition);
      current = targetState;
    }

    expect(current).toBe("DEPLOYED");
    expect(history).toHaveLength(journey.length);
    expect(history.map((transition) => transition.to)).toEqual(journey);
  });

  it("allows a founder-approved callback retry to return to the durable call queue", () => {
    const machine = new SalesStateMachine();
    const result = machine.transition({
      businessId,
      currentState: "CALLBACK_REQUESTED",
      targetState: "CALL_PENDING",
      actor: "FOUNDER",
      reason: "Founder approved the requested callback.",
      idempotencyKey: "callback-retry",
    }, []);
    expect(result.transition).toMatchObject({ from: "CALLBACK_REQUESTED", to: "CALL_PENDING" });
  });

  it("replays the same event after the committed target state is reloaded", () => {
    const machine = new SalesStateMachine();
    const command = {
      businessId,
      currentState: "CALLBACK_REQUESTED" as const,
      targetState: "FOLLOW_UP_SCHEDULED" as const,
      actor: "SCHEDULER" as const,
      reason: "Owner asked for a callback tomorrow morning.",
      idempotencyKey: `${businessId}:follow-up:2026-09-19T04:30:00.000Z`,
      metadata: { contactId: "contact-owner-1", scheduledAt: "2026-09-19T04:30:00.000Z" },
      at: "2026-09-18T10:00:00.000Z",
    };
    const first = machine.transition(command, []);
    const replay = machine.transition(
      { ...command, currentState: "FOLLOW_UP_SCHEDULED" },
      [first.transition],
    );

    expect(replay).toEqual({ transition: first.transition, replayed: true });
    expect(() => machine.transition(
      { ...command, currentState: "FOLLOW_UP_SCHEDULED", metadata: { contactId: "contact-other" } },
      [first.transition],
    )).toThrow(SalesTransitionIdempotencyConflictError);
  });

  it("rejects terminal-state escape and skipped commercial stages", () => {
    const machine = new SalesStateMachine();
    expect(() => machine.transition({
      businessId,
      currentState: "DO_NOT_CONTACT",
      targetState: "CALL_PENDING",
      actor: "SYSTEM",
      reason: "Unsafe retry.",
      idempotencyKey: "unsafe-dnc-retry",
    }, [])).toThrow(InvalidSalesTransitionError);
    expect(() => machine.transition({
      businessId,
      currentState: "NEGOTIATING",
      targetState: "DEAL_WON",
      actor: "VOICE_AGENT",
      reason: "Skipped quote.",
      idempotencyKey: "skipped-quote",
    }, [])).toThrow(InvalidSalesTransitionError);
    expect(() => machine.transition({
      businessId,
      currentState: "DEAL_LOST",
      targetState: "NEGOTIATING",
      actor: "FOUNDER",
      reason: "Attempted reopen.",
      idempotencyKey: "reopen-lost-deal",
    }, [])).toThrow(InvalidSalesTransitionError);
  });

  it("rejects reuse of an idempotency key for a different event", () => {
    const machine = new SalesStateMachine();
    const first = machine.transition({
      businessId,
      currentState: "DISCOVERED",
      targetState: "QUALIFIED",
      actor: "SALES_ORCHESTRATOR",
      reason: "Qualification passed.",
      idempotencyKey: "same-key",
    }, []);

    expect(() => machine.transition({
      businessId,
      currentState: "DISCOVERED",
      targetState: "DO_NOT_CONTACT",
      actor: "SYSTEM",
      reason: "Opted out.",
      idempotencyKey: "same-key",
    }, [first.transition])).toThrow(SalesTransitionIdempotencyConflictError);
  });
});
