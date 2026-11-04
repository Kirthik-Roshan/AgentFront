# AgentFront architecture

> Migration status (2026-09): the product target is five roles—Discover,
> Sales, Developer, Advertisement, and Delivery—running independently in the
> cloud. This repository currently implements the shared PostgreSQL
> workflow/event/run/job foundation and retains the legacy local pipeline and
> provider adapters. It is **not yet** the full autonomous AWS agency.

## Phase 1 control-tower foundation

- One `Workflow` per business provides a durable correlation ID and status.
  Merely registering a discovered/seeded business leaves it `IDLE`; an
  enqueued task marks it `ACTIVE`, and its final acknowledgement clears the
  active indication when no further job is queued.
- The existing `AgentEvent` table is the persisted control-tower ledger. New
  events include business/workflow/correlation/source-agent/payload/retry fields;
  historic lead and sales events are backfilled into the same readable feed.
- The existing leased `SalesJob` table also carries five-agent `WORKFLOW_TASK`
  jobs. New event append and downstream job enqueue are one PostgreSQL
  transaction. Old sales jobs remain compatible during cutover.
- `AgentRun` records attempts, start/end times, status, provider and errors.
  Leases must renew during long-running work. `SystemControl` persists a global
  emergency stop; an environment stop always wins over the database value.
- The API replays PostgreSQL events through a cursor-based SSE poll; the
  in-process bus remains a non-durable local demo notifier only.
- `WorkflowWorker` provides bounded retry/lease/abort mechanics, but the five
  provider-specific handlers and AWS SQS/EventBridge deployment are **future
  phases**. Running the static Vercel UI alone never runs API/workers.
- The API still exposes legacy manual/demo execution paths; do not present
  these as autonomous or proof of real provider actions.

The controlled SpiceRoute slice now includes Sarvam/Vobiz outbound calling and
post-call correlation, bounded Claude template configuration, deterministic QA,
Vercel deployment, and Dodo test checkout. The next migration must generalize
those handlers beyond one approved business and add GitHub automation, complete
Freshsales/Freshdesk lifecycle handling, Google/Meta + ElevenLabs-media
Advertisement, and read-only Wispr supervision. The Codex CLI and ElevenLabs
browser sales adapters remain legacy and must not be described as the primary
target.

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

The API validates input, authorizes the founder, resolves provider health, accepts commands, and serves read models. With PostgreSQL configured, accepted legacy pipeline-continuation commands append a persisted event and enqueue a `WORKFLOW_TASK` atomically. The separate worker leases that job and invokes the existing orchestrator. SSE reads the persisted event feed by cursor, so another API process can observe committed milestones. Without PostgreSQL, the explicitly labelled credential-free demo still uses an in-process continuation and event bus. These two modes must not be conflated.

### Orchestrator

The orchestrator accepts a command only when its transition is valid. Each stage:

1. verifies the current state and stage guard;
2. calls the selected provider with the canonical project correlation and an idempotency key where supported;
3. records returned external identifiers on the aggregate;
4. persists the aggregate, transitions, events, and revenue records atomically through the repository;
5. returns the updated projection or parks at a retryable state.

PostgreSQL-backed legacy pipeline effects now execute in a worker process after a durable queue handoff. Their individual provider calls still follow the older synchronous orchestrator path, and a crash between a provider side effect and its persisted acknowledgement can repeat that side effect. The queue and event append are transactional; provider-specific crash reconciliation and a complete five-role event-driven handoff are not implemented. The credential-free demo remains process-local.

### Worker

The worker package runs a PostgreSQL-leased sales/CRM worker and a
`WorkflowWorker` with renewable leases, bounded retries, attempt records, and
emergency-stop checks. Its controlled `SALES` path accepts correlated Sarvam
results and its `DEVELOPER` handoff can invoke bounded Claude configuration,
QA, and Vercel through the existing orchestrator. These remain transitional,
single-demo-business wrappers rather than the complete five-role design;
GitHub creation, discovery scheduling, advertisement, general delivery, SQS
consumption, and EventBridge callbacks are still future work. Build jobs must
receive a resolved project ID and validated spec—never an arbitrary directory
or command—and deployment requires a passing QA result.

### Database

When `DATABASE_URL` is configured, PostgreSQL is the source of record. Additive `Workflow`, `AgentRun`, and `SystemControl` tables supplement the existing `AgentEvent` ledger and leased `SalesJob` queue. JSON columns hold provider payload fragments, score explanations, and approved specifications, while relational columns retain lifecycle queries and integrity. Without PostgreSQL, the explicitly reported credential-free demo uses the in-memory repository. Redis is not an active queue and never the source of truth.

## State machine

Transitions are explicit and monotonic on the happy path. Failure states retain the source stage needed for a safe retry. `DEAL_LOST`, `REJECTED`, and `NOT_INTERESTED` are commercial terminal states; build/deploy failures are operational recovery states.

While connected, lifecycle stages are reconciled from returned aggregates and orchestrator events. The browser-only demo may animate a clearly labelled simulated journey. A second `start` command for an already-started business/campaign pair returns the existing operation.

## Provider selection

Provider factories inspect server-side configuration at process start and expose an authenticated health projection:

```ts
type ProviderMode = 'REAL' | 'DEMO';

type ProviderHealth = {
  integration: 'places' | 'crm' | 'support' | 'conversation' | 'telephony'
    | 'scheduler' | 'jobQueue' | 'developer' | 'deployment';
  mode: ProviderMode;
  status: 'CONNECTED' | 'DEMO' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
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
- The Sarvam callback uses a high-entropy URL token plus persisted attempt,
  business and call correlation because that callback does not currently expose
  a documented signature. The Dodo test callback verifies its provider
  signature and event idempotency. Every additional webhook must implement the
  strongest verification and replay protection its provider supports.
- Logs redact configured secrets and minimize raw transcript exposure.
- Codex `workspace-write` limits writes but is not a tenant security boundary because the process can still read host-visible files. A production multi-tenant deployment must run builds in an OS/container sandbox with a minimal filesystem and environment.
- Production deployments should add tenant-scoped authorization, encryption, rate limits, and audited session management.

## Observability

New workflow events include `businessId`, `workflowId`, `correlationId`, `sourceAgent`, `eventType`, `timestamp`, `status`, `retryCount`, and payload; legacy records retain their older project/lead/campaign fields. PostgreSQL mode persists events and agent attempts for an explainable control-tower feed. The browser-only demo is intentionally non-durable, and several older dashboard metrics still represent prototype data rather than production operations.

## Scaling path

The Phase 1 PostgreSQL ledger and job leases establish a durable local-process-independent handoff, not a completed cloud deployment. Scale-out still requires provider-specific idempotency/reconciliation, operational monitoring, isolated build execution, complete five-role handlers, and AWS queue/scheduler adapters. Do not treat SQS, EventBridge, RDS, or CloudWatch as already provisioned by this repository.
