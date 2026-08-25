# AgentFront architecture

## Design goals

AgentFront is one traceable commercial workflow. It is not a set of agent demos. The architecture therefore optimizes for five invariants:

1. One canonical project identifier follows every provider record and artifact.
2. The orchestrator is the only authority that advances lifecycle state.
3. External providers are replaceable and always have an honest demo fallback.
4. Commercial rules are deterministic and enforced outside generative models.
5. Retried work is stage-guarded and correlation-aware; durable cross-process provider reconciliation remains an explicit scaling requirement.

## Runtime boundaries

### Web

When the API is connected, the founder control center hydrates lifecycle state from API projections and applies new structured events from SSE. The credential-free browser fallback is explicitly labelled and keeps only walkthrough preferences and its simulated step locally.

### API

The API validates input, authorizes the founder, resolves provider health, accepts commands, and serves read models. The Stage‑1 runtime starts orchestration in a guarded background microtask so the command returns immediately, and SSE streams structured events to the control center. This is intentionally a single-orchestrator topology; durable cross-process job claiming is a scaling step, not a capability claimed by the demo runtime.

### Orchestrator

The orchestrator accepts a command only when its transition is valid. Each stage:

1. verifies the current state and stage guard;
2. calls the selected provider with the canonical project correlation and an idempotency key where supported;
3. records returned external identifiers on the aggregate;
4. persists the aggregate, transitions, events, and revenue records atomically through the repository;
5. returns the updated projection or parks at a retryable state.

Stage‑1 effects execute inline in the single orchestrator process. SSE publication is best-effort and is not a durable event-delivery channel. A transactional outbox, distributed job claiming, and provider-specific crash reconciliation are production scaling work, not capabilities claimed by this repository.

### Worker

The worker package defines and tests the idempotent typed-job boundary for the distributed topology. It is a local scaffold today, not a Redis consumer: Stage‑1 build and deployment effects execute through the same orchestrator process. In the production topology, build jobs receive a resolved project ID and validated spec—never an arbitrary directory or command—and deployment jobs require a passing QA result.

### Database

When `DATABASE_URL` is configured, PostgreSQL is the source of record. JSON columns hold provider payload fragments, score explanations, and approved specifications, while relational columns retain lifecycle queries and integrity. Without it, the explicitly reported credential-free demo uses the in-memory repository. Redis is planned coordination infrastructure, not a currently active queue and never the source of truth.

## State machine

Transitions are explicit and monotonic on the happy path. Failure states retain the source stage needed for a safe retry. `DEAL_LOST`, `REJECTED`, and `NOT_INTERESTED` are commercial terminal states; build/deploy failures are operational recovery states.

While connected, lifecycle stages are reconciled from returned aggregates and orchestrator events. The browser-only demo may animate a clearly labelled simulated journey. A second `start` command for an already-started business/campaign pair returns the existing operation.

## Provider selection

Provider factories inspect server-side configuration at process start and expose an authenticated health projection:

```ts
type ProviderMode = 'REAL' | 'DEMO';

type ProviderHealth = {
  integration: 'places' | 'crm' | 'conversation' | 'developer' | 'deployment';
  mode: ProviderMode;
  status: 'CONNECTED' | 'DEMO' | 'DEGRADED' | 'NOT_CONFIGURED';
  checkedAt: string;
};
```

Core orchestration depends on interfaces in `packages/types`, never on vendor classes.

## Security model

- Provider credentials are read only by API/worker processes.
- Browser-facing configuration contains status, never raw secrets.
- Project specs are data files validated against allow-listed feature keys.
- The Codex provider uses process argument arrays and a fixed executable.
- Runtime build paths are resolved below the ignored `.agentfront-runtime/generated-sites/` root, carry immutable ownership metadata, and reject symbolic links.
- Customer content is never concatenated into executable commands.
- REAL conversation access is minted only after explicit consent, is returned with `no-store`, and is never persisted in lead projections.
- Provider conversation IDs are verified against the configured ElevenLabs agent before binding; governed completion requires a separate tool secret, exact correlation, and idempotency.
- A future direct provider webhook receiver must add the provider's documented signature verification and replay protection; the current repository does not claim one.
- Logs redact configured secrets and minimize raw transcript exposure.
- Codex `workspace-write` limits writes but is not a tenant security boundary because the process can still read host-visible files. A production multi-tenant deployment must run builds in an OS/container sandbox with a minimal filesystem and environment.
- Production deployments should add tenant-scoped authorization, encryption, rate limits, and audited session management.

## Observability

Every structured event includes `projectId`, `leadId`, `campaignId`, `agent`, `event`, `timestamp`, `status`, and optional duration/metadata. PostgreSQL mode persists events and relational projections so revenue and funnel totals remain explainable; the in-memory demo is intentionally non-durable.

## Scaling path

The Stage‑1 API and demo projection are intentionally lightweight. The contracts permit replacing in-process scheduling with BullMQ/Redis, running workers horizontally, adding a transactional outbox, and materializing analytics without changing the founder-facing workflow.
