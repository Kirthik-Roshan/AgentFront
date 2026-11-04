# Sales orchestration

AgentFront treats sales as a durable backend workflow. The browser is an
operator/control plane; closing it does not own or cancel calls, callbacks,
provider synchronization, or delivery work.

## Identity and state

`Business.id` is the permanent identity. Phone numbers belong to `Contact`
records, and one business may have a public line, receptionist, manager, owner,
and other contacts. Normalized E.164 numbers are lookup keys, not business IDs.

The existing `PipelineState` remains the coarse acquisition-to-deployment
lifecycle. `SalesState` is the detailed sales lifecycle used for role discovery,
callbacks, negotiation, opt-out, and resumption. Every state change appends a
`SalesEvent`; the current state is persisted for efficient reads.

Core durable records are:

- `Contact`: role, decision-maker authority, language, verification and CRM ID
- `Call`: direction, provider correlation, status, outcome, transcript and summary
- `SalesMemory`: objections, normalized requirements, commercial state and next action
- `FollowUp`: scheduled callbacks with attempts, status and a dedupe key
- `SalesEvent`: append-only audit trail and state-transition metadata
- `SalesJob`: restart-safe work, leases, retries and dead-letter status
- `CRMOutbox`: transactional outbox for Freshworks synchronization
- `SalesProjectSpec`: the accepted structured scope handed to delivery

## Provider boundaries

The sales orchestrator depends on provider contracts, not vendor APIs.

- `TelephonyProvider` owns outbound calls, termination, inbound parsing and
  webhook verification.
- `VoiceAgentProvider` owns voice sessions, transcripts and runtime context.
- `CRMProvider` mirrors approved commercial events to Freshworks.
- `SalesRepository`, `JobQueue` and `Scheduler` isolate PostgreSQL/local runtime
  details from the domain workflow.

Only adapters with usable credentials may report `CONNECTED`. Selecting a real
telephony provider without complete configuration reports a degraded or
unavailable state. The controlled SpiceRoute path uses
`SarvamVobizTelephonyProvider`; it verifies the public callback before dialing
and accepts a result only when its attempt, business and call correlations
match PostgreSQL. `DemoTelephonyProvider` remains available for explicitly
labelled simulation and is never presented as a real phone call.

The separate worker writes a PostgreSQL heartbeat every five seconds. The
Settings health panel reports the durable job queue separately from worker
freshness; an API process being online does not imply jobs are running.

## Inbound caller resolution

1. Normalize the caller to E.164.
2. Find matching contacts by normalized phone.
3. If exactly one match exists, load its business, sales memory, previous calls
   and pending follow-ups.
4. If multiple matches exist, disclose no confidential context until safe
   secondary identification resolves the ambiguity.
5. If no match exists, start as `UNKNOWN_CALLER` and collect identity politely.

Knowing a business name is never sufficient authorization to reveal prior
conversations or commercial details.

## Failure behavior

AgentFront commits its own state before external synchronization. Freshworks
failures enter the CRM outbox and retry with bounded backoff. Telephony or voice
failures create explicit failure events and retain a recoverable next action.
`DO_NOT_CONTACT`, blocked numbers, calling windows, maximum attempts and active
call locks are evaluated before automated outreach.

## Local operation

Run PostgreSQL migrations and start the API plus worker:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

Use `TELEPHONY_PROVIDER=demo` for an explicit simulated call flow. A real voice
or CRM adapter may still be used independently; demo telephony is never labelled
as a real phone call.

## Controlled SpiceRoute demo, including a real site build

Keep `DATABASE_URL` configured so the API and worker share durable state. Leave
`DEMO_MODE` blank or `false`, set `TELEPHONY_PROVIDER=sarvam`, and configure the
Sarvam/Vobiz callback described in
[SARVAM_SALES_AGENT.md](./SARVAM_SALES_AGENT.md). For the real build and
deployment, set `DEVELOPER_PROVIDER=openai`, provide `OPENAI_API_KEY`, set
`DEPLOY_PROVIDER=vercel`, provide `DEPLOY_TOKEN`, and set `VERCEL_TEAM_ID` for a
team-scoped deployment. The Sarvam, OpenAI,
PostgreSQL worker and Vercel health rows must all show `REAL · CONNECTED` before
the reviewed call starts.

1. Open **Discover**, inspect **SpiceRoute Kitchen**, and select **Approve &
   call with Sarvam** during the configured calling window.
2. Confirm the browser warning once. AgentFront queues the persisted sales
   record and asks Sarvam/Vobiz to call only the configured consented number.
3. Complete the call as the owner. Sarvam posts the final transcript and
   structured variables to the correlated AgentFront callback.
4. AgentFront validates the owner, agreed ₹100 price and required scope. Only
   then does it persist the project specification and enqueue
   `TRIGGER_DEVELOPER`.
5. The worker invokes OpenAI once for a schema-compatible edit to the existing
   restaurant configuration, then runs deterministic QA and Vercel deployment
   without another dashboard button.

The separate Sales Operations controls remain useful for explicitly labelled
simulation and recovery testing; they are not the panel demo's production
handoff.

If an older SpiceRoute pipeline lead is already deployed, the worker preserves
that deployment and creates a separate delivery lead for the newly approved
sales specification. It never overwrites the older scope.

The authenticated founder API exposes `GET /api/sales/overview`,
`GET /api/sales/businesses/:id`, and sales mutations under
`/api/sales/businesses/:id/*`; mutations require an `Idempotency-Key` header.
The 17 `/api/voice/tools/:name` endpoints require a separate
`ELEVENLABS_TOOL_SECRET` Bearer token **and** a matching business ID, sales
call ID, and provider call ID. Do not put this secret in browser code. The
voice tools are backend actions for a configured ElevenLabs agent; the
simulated telephony buttons do not create a real ElevenLabs phone call.

The controlled outbound Sarvam Instant Outbound adapter uses the configured
Vobiz connection. Generic Exotel/Twilio adapters, a phone-to-ElevenLabs media
bridge and public inbound PSTN handling are not implemented. Inbound simulation
is founder-authenticated and DEMO-only; it is not a provider webhook.
