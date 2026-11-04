import type { SalesState } from "@agentfront/types";

export const INDIA_CALLING_TIME_ZONE = "Asia/Kolkata";

export interface SalesCallingWindow {
  start: string;
  end: string;
  timezone?: string;
}

export interface OutboundCallPolicy {
  callingWindow: SalesCallingWindow;
  maximumCallsPerDay: number;
  maximumAttempts: number;
  minimumMinutesBetweenAttempts?: number;
}

export interface OutboundCallEligibilityInput {
  salesState: SalesState;
  doNotContact: boolean;
  numberBlocked: boolean;
  hasCallablePhone: boolean;
  activeCallExists: boolean;
  attempts: number;
  callsToday: number;
  scheduledAt?: string | null;
  lastAttemptAt?: string | null;
  unsupportedRegion?: boolean;
  humanReviewRequired?: boolean;
  now?: Date | string;
}

export type OutboundCallDenialReason =
  | "DO_NOT_CONTACT"
  | "BLOCKED_NUMBER"
  | "UNSUPPORTED_REGION"
  | "HUMAN_REVIEW_REQUIRED"
  | "PHONE_REQUIRED"
  | "CALL_ALREADY_ACTIVE"
  | "STATE_NOT_CALLABLE"
  | "MAX_ATTEMPTS_REACHED"
  | "DAILY_CALL_LIMIT_REACHED"
  | "FOLLOW_UP_NOT_SCHEDULED"
  | "FOLLOW_UP_NOT_DUE"
  | "RATE_LIMITED"
  | "OUTSIDE_CALLING_WINDOW";

export type OutboundCallEligibility =
  | { allowed: true; reason: "ELIGIBLE" }
  | { allowed: false; reason: OutboundCallDenialReason; retryAt?: string };

export class InvalidSalesPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSalesPolicyError";
  }
}

const OUTBOUND_CALLABLE_STATES: ReadonlySet<SalesState> = new Set([
  "QUALIFIED",
  "CALL_PENDING",
  "OWNER_CONTACT_IDENTIFIED",
  "FOLLOW_UP_SCHEDULED",
  "FOLLOW_UP_REQUIRED",
]);

const parseMinuteOfDay = (value: string, label: string): number => {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) throw new InvalidSalesPolicyError(`${label} must use 24-hour HH:mm format.`);
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

const toDate = (value: Date | string, label: string): Date => {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new InvalidSalesPolicyError(`${label} must be a valid timestamp.`);
  return result;
};

const nonNegativeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidSalesPolicyError(`${label} must be a non-negative integer.`);
  }
};

const positiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidSalesPolicyError(`${label} must be a positive integer.`);
  }
};

const localMinuteOfDay = (at: Date, timezone: string): number => {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new InvalidSalesPolicyError(`Unsupported calling-window timezone: ${timezone}.`);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new InvalidSalesPolicyError("Unable to resolve the calling-window local time.");
  }
  return hour * 60 + minute;
};

export function isWithinCallingWindow(
  at: Date | string,
  window: SalesCallingWindow,
): boolean {
  const timestamp = toDate(at, "at");
  const timezone = window.timezone?.trim() || INDIA_CALLING_TIME_ZONE;
  const start = parseMinuteOfDay(window.start, "callingWindow.start");
  const end = parseMinuteOfDay(window.end, "callingWindow.end");
  if (start === end) {
    throw new InvalidSalesPolicyError("Calling-window start and end must differ.");
  }
  const current = localMinuteOfDay(timestamp, timezone);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

export function evaluateOutboundCallEligibility(
  input: OutboundCallEligibilityInput,
  policy: OutboundCallPolicy,
): OutboundCallEligibility {
  // Permanent safety decisions always win, including when other configuration
  // is temporarily invalid or incomplete.
  if (input.doNotContact || input.salesState === "DO_NOT_CONTACT") {
    return { allowed: false, reason: "DO_NOT_CONTACT" };
  }
  if (input.numberBlocked) return { allowed: false, reason: "BLOCKED_NUMBER" };
  if (input.unsupportedRegion) return { allowed: false, reason: "UNSUPPORTED_REGION" };
  if (input.humanReviewRequired) return { allowed: false, reason: "HUMAN_REVIEW_REQUIRED" };
  if (!input.hasCallablePhone) return { allowed: false, reason: "PHONE_REQUIRED" };
  if (input.activeCallExists) return { allowed: false, reason: "CALL_ALREADY_ACTIVE" };
  if (!OUTBOUND_CALLABLE_STATES.has(input.salesState)) {
    return { allowed: false, reason: "STATE_NOT_CALLABLE" };
  }

  positiveInteger(policy.maximumAttempts, "maximumAttempts");
  positiveInteger(policy.maximumCallsPerDay, "maximumCallsPerDay");
  nonNegativeInteger(input.attempts, "attempts");
  nonNegativeInteger(input.callsToday, "callsToday");
  const minimumMinutes = policy.minimumMinutesBetweenAttempts ?? 0;
  if (!Number.isFinite(minimumMinutes) || minimumMinutes < 0) {
    throw new InvalidSalesPolicyError("minimumMinutesBetweenAttempts must be non-negative.");
  }

  if (input.attempts >= policy.maximumAttempts) {
    return { allowed: false, reason: "MAX_ATTEMPTS_REACHED" };
  }
  if (input.callsToday >= policy.maximumCallsPerDay) {
    return { allowed: false, reason: "DAILY_CALL_LIMIT_REACHED" };
  }

  const now = toDate(input.now ?? new Date(), "now");
  if (input.salesState === "FOLLOW_UP_SCHEDULED" && !input.scheduledAt) {
    return { allowed: false, reason: "FOLLOW_UP_NOT_SCHEDULED" };
  }
  if (input.scheduledAt) {
    const scheduledAt = toDate(input.scheduledAt, "scheduledAt");
    if (scheduledAt.getTime() > now.getTime()) {
      return { allowed: false, reason: "FOLLOW_UP_NOT_DUE", retryAt: scheduledAt.toISOString() };
    }
  }

  if (input.lastAttemptAt && minimumMinutes > 0) {
    const lastAttemptAt = toDate(input.lastAttemptAt, "lastAttemptAt");
    const retryAt = new Date(lastAttemptAt.getTime() + minimumMinutes * 60_000);
    if (retryAt.getTime() > now.getTime()) {
      return { allowed: false, reason: "RATE_LIMITED", retryAt: retryAt.toISOString() };
    }
  }

  if (!isWithinCallingWindow(now, policy.callingWindow)) {
    return { allowed: false, reason: "OUTSIDE_CALLING_WINDOW" };
  }
  return { allowed: true, reason: "ELIGIBLE" };
}
