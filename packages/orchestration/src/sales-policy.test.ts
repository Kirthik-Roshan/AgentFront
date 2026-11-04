import { describe, expect, it } from "vitest";
import {
  InvalidSalesPolicyError,
  evaluateOutboundCallEligibility,
  isWithinCallingWindow,
  type OutboundCallEligibilityInput,
  type OutboundCallPolicy,
} from "./sales-policy";

const policy: OutboundCallPolicy = {
  callingWindow: { start: "09:00", end: "18:00", timezone: "Asia/Kolkata" },
  maximumCallsPerDay: 20,
  maximumAttempts: 3,
  minimumMinutesBetweenAttempts: 30,
};

const eligible: OutboundCallEligibilityInput = {
  salesState: "QUALIFIED",
  doNotContact: false,
  numberBlocked: false,
  hasCallablePhone: true,
  activeCallExists: false,
  attempts: 0,
  callsToday: 0,
  now: "2026-09-18T04:00:00.000Z", // 09:30 in Asia/Kolkata
};

describe("outbound sales call policy", () => {
  it("allows an eligible qualified business during the India calling window", () => {
    expect(evaluateOutboundCallEligibility(eligible, policy)).toEqual({
      allowed: true,
      reason: "ELIGIBLE",
    });
  });

  it("gives permanent opt-out and blocked-number rules precedence", () => {
    expect(evaluateOutboundCallEligibility({ ...eligible, doNotContact: true }, policy)).toEqual({
      allowed: false,
      reason: "DO_NOT_CONTACT",
    });
    expect(evaluateOutboundCallEligibility({
      ...eligible,
      salesState: "DO_NOT_CONTACT",
    }, policy)).toEqual({ allowed: false, reason: "DO_NOT_CONTACT" });
    expect(evaluateOutboundCallEligibility({ ...eligible, numberBlocked: true }, policy)).toEqual({
      allowed: false,
      reason: "BLOCKED_NUMBER",
    });
  });

  it("rejects active calls, non-callable states, max retries and daily rate exhaustion", () => {
    expect(evaluateOutboundCallEligibility({ ...eligible, activeCallExists: true }, policy).reason)
      .toBe("CALL_ALREADY_ACTIVE");
    expect(evaluateOutboundCallEligibility({ ...eligible, salesState: "DEAL_WON" }, policy).reason)
      .toBe("STATE_NOT_CALLABLE");
    expect(evaluateOutboundCallEligibility({ ...eligible, attempts: 3 }, policy).reason)
      .toBe("MAX_ATTEMPTS_REACHED");
    expect(evaluateOutboundCallEligibility({ ...eligible, callsToday: 20 }, policy).reason)
      .toBe("DAILY_CALL_LIMIT_REACHED");
  });

  it("waits for a scheduled callback and enforces spacing between attempts", () => {
    expect(evaluateOutboundCallEligibility({
      ...eligible,
      salesState: "FOLLOW_UP_SCHEDULED",
      scheduledAt: null,
    }, policy)).toEqual({ allowed: false, reason: "FOLLOW_UP_NOT_SCHEDULED" });

    expect(evaluateOutboundCallEligibility({
      ...eligible,
      salesState: "FOLLOW_UP_SCHEDULED",
      scheduledAt: "2026-09-18T05:00:00.000Z",
    }, policy)).toEqual({
      allowed: false,
      reason: "FOLLOW_UP_NOT_DUE",
      retryAt: "2026-09-18T05:00:00.000Z",
    });

    expect(evaluateOutboundCallEligibility({
      ...eligible,
      lastAttemptAt: "2026-09-18T03:50:00.000Z",
    }, policy)).toEqual({
      allowed: false,
      reason: "RATE_LIMITED",
      retryAt: "2026-09-18T04:20:00.000Z",
    });
  });

  it("uses Asia/Kolkata local time and excludes the end boundary", () => {
    expect(isWithinCallingWindow("2026-09-18T03:30:00.000Z", policy.callingWindow)).toBe(true);
    expect(isWithinCallingWindow("2026-09-18T12:29:59.000Z", policy.callingWindow)).toBe(true);
    expect(isWithinCallingWindow("2026-09-18T12:30:00.000Z", policy.callingWindow)).toBe(false);
    expect(evaluateOutboundCallEligibility({
      ...eligible,
      now: "2026-09-18T13:00:00.000Z",
    }, policy)).toEqual({ allowed: false, reason: "OUTSIDE_CALLING_WINDOW" });
  });

  it("supports an overnight window and fails closed on invalid policy", () => {
    expect(isWithinCallingWindow("2026-09-18T18:00:00.000Z", {
      start: "22:00",
      end: "06:00",
      timezone: "Asia/Kolkata",
    })).toBe(true); // 23:30 IST
    expect(() => isWithinCallingWindow(eligible.now!, {
      start: "09:00",
      end: "09:00",
      timezone: "Asia/Kolkata",
    })).toThrow(InvalidSalesPolicyError);
    expect(() => evaluateOutboundCallEligibility(eligible, {
      ...policy,
      maximumAttempts: 0,
    })).toThrow(InvalidSalesPolicyError);
  });
});
