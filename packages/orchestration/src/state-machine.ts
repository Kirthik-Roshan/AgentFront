import type { AgentType, PipelineState, PipelineTransition } from "@agentfront/types";

export const PIPELINE_TRANSITIONS: Readonly<Record<PipelineState, readonly PipelineState[]>> = {
  DISCOVERED: ["QUALIFIED", "REJECTED"],
  // A separately verified sales conversation may hand a won, approved spec
  // directly to delivery without inventing legacy CRM/voice transitions.
  QUALIFIED: ["CRM_CREATED", "SPEC_GENERATED"],
  CRM_CREATED: ["OUTREACH_READY"],
  OUTREACH_READY: ["CONVERSATION_ACTIVE", "NOT_INTERESTED", "FOLLOW_UP"],
  CONVERSATION_ACTIVE: ["REQUIREMENTS_COLLECTED", "NOT_INTERESTED", "FOLLOW_UP"],
  REQUIREMENTS_COLLECTED: ["NEGOTIATING"],
  NEGOTIATING: ["DEAL_WON", "DEAL_LOST", "FOLLOW_UP"],
  DEAL_WON: ["SPEC_GENERATED"],
  SPEC_GENERATED: ["BUILD_QUEUED"],
  BUILD_QUEUED: ["BUILDING"],
  BUILDING: ["QA", "BUILD_FAILED"],
  QA: ["DEPLOYING", "BUILD_FAILED"],
  DEPLOYING: ["DEPLOYED", "DEPLOY_FAILED"],
  DEPLOYED: [],
  REJECTED: [],
  NOT_INTERESTED: [],
  FOLLOW_UP: ["OUTREACH_READY"],
  DEAL_LOST: [],
  BUILD_FAILED: ["BUILD_QUEUED"],
  DEPLOY_FAILED: ["DEPLOYING"],
};

export class InvalidPipelineTransitionError extends Error {
  constructor(from: PipelineState, to: PipelineState) {
    super(`Invalid AgentFront pipeline transition: ${from} -> ${to}.`);
    this.name = "InvalidPipelineTransitionError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key ${key} was already used for a different transition.`);
    this.name = "IdempotencyConflictError";
  }
}

export interface TransitionCommand {
  leadId: string;
  projectId: string;
  currentState: PipelineState;
  targetState: PipelineState;
  actor: AgentType | "FOUNDER" | "SYSTEM";
  reason: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  at?: string;
}

export interface TransitionResult {
  transition: PipelineTransition;
  replayed: boolean;
}

export function canTransition(from: PipelineState, to: PipelineState): boolean {
  return PIPELINE_TRANSITIONS[from].includes(to);
}

export class PipelineStateMachine {
  transition(command: TransitionCommand, history: readonly PipelineTransition[]): TransitionResult {
    const previous = history.find((item) => item.idempotencyKey === command.idempotencyKey);
    if (previous) {
      if (previous.leadId !== command.leadId || previous.to !== command.targetState) {
        throw new IdempotencyConflictError(command.idempotencyKey);
      }
      return { transition: previous, replayed: true };
    }

    if (!canTransition(command.currentState, command.targetState)) {
      throw new InvalidPipelineTransitionError(command.currentState, command.targetState);
    }

    const transition: PipelineTransition = {
      id: `transition-${command.projectId}-${history.length + 1}`,
      leadId: command.leadId,
      projectId: command.projectId,
      from: command.currentState,
      to: command.targetState,
      actor: command.actor,
      reason: command.reason,
      idempotencyKey: command.idempotencyKey,
      metadata: command.metadata ?? {},
      createdAt: command.at ?? new Date().toISOString(),
    };
    return { transition, replayed: false };
  }
}
