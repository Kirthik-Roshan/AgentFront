import type { SalesState, SalesStateTransitionRecord } from "@agentfront/types";

/**
 * Sales lifecycle transitions are deliberately separate from the existing
 * fulfilment pipeline. A won deal hands off to specification/build, while the
 * contact and callback states remain auditable on the business sales record.
 */
export const SALES_STATE_TRANSITIONS: Readonly<Record<SalesState, readonly SalesState[]>> = {
  DISCOVERED: ["QUALIFIED", "DO_NOT_CONTACT"],
  QUALIFIED: ["CALL_PENDING", "DO_NOT_CONTACT", "DEAL_LOST"],
  CALL_PENDING: ["CALLING", "FOLLOW_UP_SCHEDULED", "DO_NOT_CONTACT", "DEAL_LOST"],
  CALLING: ["CONTACTED", "FOLLOW_UP_REQUIRED", "DO_NOT_CONTACT", "DEAL_LOST"],
  CONTACTED: [
    "RECEPTIONIST_CONTACTED",
    "DECISION_MAKER_REQUIRED",
    "OWNER_CONTACTED",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  RECEPTIONIST_CONTACTED: [
    "DECISION_MAKER_REQUIRED",
    "OWNER_CONTACT_IDENTIFIED",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  DECISION_MAKER_REQUIRED: [
    "OWNER_CONTACT_IDENTIFIED",
    "OWNER_CONTACTED",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  OWNER_CONTACT_IDENTIFIED: [
    "CALL_PENDING",
    "OWNER_CONTACTED",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_SCHEDULED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  CALLBACK_REQUESTED: [
    "CALL_PENDING",
    "FOLLOW_UP_SCHEDULED",
    "OWNER_CONTACTED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  FOLLOW_UP_SCHEDULED: [
    "CALL_PENDING",
    "OWNER_CONTACTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  OWNER_CONTACTED: [
    "DISCOVERY_CONVERSATION",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  DISCOVERY_CONVERSATION: [
    "REQUIREMENTS_COLLECTING",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  REQUIREMENTS_COLLECTING: [
    "NEGOTIATING",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  NEGOTIATING: [
    "QUOTE_PRESENTED",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
    "DEAL_LOST",
  ],
  QUOTE_PRESENTED: [
    "NEGOTIATING",
    "DEAL_WON",
    "DEAL_LOST",
    "CALLBACK_REQUESTED",
    "FOLLOW_UP_REQUIRED",
    "DO_NOT_CONTACT",
  ],
  FOLLOW_UP_REQUIRED: ["FOLLOW_UP_SCHEDULED", "CALL_PENDING", "DO_NOT_CONTACT", "DEAL_LOST"],
  DEAL_WON: ["SPEC_GENERATED"],
  DEAL_LOST: [],
  DO_NOT_CONTACT: [],
  SPEC_GENERATED: ["BUILD_PENDING"],
  BUILD_PENDING: ["BUILDING"],
  BUILDING: ["QA"],
  QA: ["BUILDING", "DEPLOYING"],
  DEPLOYING: ["DEPLOYED"],
  DEPLOYED: [],
};

export type SalesTransitionActor =
  | "SALES_ORCHESTRATOR"
  | "VOICE_AGENT"
  | "TELEPHONY"
  | "SCHEDULER"
  | "FOUNDER"
  | "SYSTEM";

export type SalesTransition = SalesStateTransitionRecord;

export interface SalesTransitionCommand {
  businessId: string;
  currentState: SalesState;
  targetState: SalesState;
  actor: SalesTransitionActor;
  reason: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  at?: string;
}

export interface SalesTransitionResult {
  transition: SalesTransition;
  replayed: boolean;
}

export class InvalidSalesTransitionError extends Error {
  constructor(from: SalesState, to: SalesState) {
    super(`Invalid AgentFront sales transition: ${from} -> ${to}.`);
    this.name = "InvalidSalesTransitionError";
  }
}

export class SalesTransitionIdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Sales transition idempotency key ${key} was already used for a different command.`);
    this.name = "SalesTransitionIdempotencyConflictError";
  }
}

export function canTransitionSalesState(from: SalesState, to: SalesState): boolean {
  return SALES_STATE_TRANSITIONS[from].includes(to);
}

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const metadataMatches = (left: Record<string, unknown>, right: Record<string, unknown>): boolean =>
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));

const transitionMatchesReplay = (
  previous: SalesTransition,
  command: SalesTransitionCommand,
): boolean =>
  previous.businessId === command.businessId &&
  previous.to === command.targetState &&
  previous.actor === command.actor &&
  previous.reason === command.reason.trim() &&
  metadataMatches(previous.metadata, command.metadata ?? {}) &&
  // A delivery retry can observe either the state used by the original command
  // or the already-committed target state. Both represent the same event.
  (command.currentState === previous.from || command.currentState === previous.to);

export class SalesStateMachine {
  transition(
    command: SalesTransitionCommand,
    history: readonly SalesTransition[],
  ): SalesTransitionResult {
    const businessId = required(command.businessId, "businessId");
    const idempotencyKey = required(command.idempotencyKey, "idempotencyKey");
    const reason = required(command.reason, "reason");
    const previous = history.find((item) => item.idempotencyKey === idempotencyKey);

    if (previous) {
      if (!transitionMatchesReplay(previous, { ...command, businessId, idempotencyKey, reason })) {
        throw new SalesTransitionIdempotencyConflictError(idempotencyKey);
      }
      return { transition: previous, replayed: true };
    }

    if (!canTransitionSalesState(command.currentState, command.targetState)) {
      throw new InvalidSalesTransitionError(command.currentState, command.targetState);
    }

    const createdAt = command.at ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) throw new TypeError("Sales transition timestamp is invalid.");

    return {
      replayed: false,
      transition: {
        id: `sales-transition-${businessId}-${history.length + 1}`,
        businessId,
        from: command.currentState,
        to: command.targetState,
        actor: command.actor,
        reason,
        idempotencyKey,
        metadata: structuredClone(command.metadata ?? {}),
        createdAt: new Date(createdAt).toISOString(),
      },
    };
  }
}
