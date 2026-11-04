# AgentFront

> Architecture transition: AgentFront is becoming a five-agent autonomous
> cloud agency with a read-only control tower. The Phase 1 PostgreSQL
> workflow/event/agent-run/job foundation is in this repository. The controlled
> SpiceRoute path now supports a founder-approved Sarvam/Vobiz call, correlated
> post-call requirements, bounded OpenAI edits to an existing template, QA and
> Vercel CLI deployment. GitHub automation, Google/Meta publishing, general
> autonomous customer delivery, Wispr supervision and AWS deployment are still
> future work. A SpiceRoute-only Dodo test-checkout path exists; it is not a
> general Delivery Agent.

Phase 1 requires PostgreSQL: `npm run db:migrate` after configuring
`DATABASE_URL`. Authenticated `GET /api/workflows`, `/api/agent-runs`, and
`GET /api/events?after=<event-id>` expose persisted status/history;
`/api/events/stream` replays recent persisted milestones and polls across
processes. `POST /api/control/emergency-stop` with `{ "stopped": true }`
pauses new PostgreSQL-backed worker activity (resume with `false`); setting
`GLOBAL_EMERGENCY_STOP=true` is a stronger deployment-level stop. With
`DATABASE_URL` configured, `npm run dev` starts the API, worker and web app with
the same database so queued work can advance. The credential-free browser
journey remains explicitly a local demo.

**An autonomous digital-agency target, observed from one control center.**

The existing prototype can discover underserved local businesses and run parts of a guarded CRM, sales, template-build, QA, and deployment journey. It does not yet run the complete five-agent flow unattended in the cloud. The dashboard is being migrated from a demo-driven execution UI into a supervision layer.

This repository includes a credential-free Stage‑1 demo and a Phase 1 durable foundation. Seeded or simulated provider output must remain labelled `DEMO`; a completed browser walkthrough is not evidence of a real call, ad impression, payment, or cloud deployment.

> AgentFront does not merely generate websites. AgentFront operates the acquisition-to-delivery business around them.

## What is implemented

- Founder operations center, with persisted workflow/event/run panels in PostgreSQL mode and some legacy demo-derived metrics elsewhere
- Map-style business discovery with 32 realistic Chennai businesses across four MVP industries
- Opportunity intelligence, deterministic scoring, and qualification explanations
- A guarded, idempotent lead state machine with a canonical `AF-YYYY-NNNNNN` project identifier
- SpiceRoute Kitchen legacy walkthrough: discovery → CRM → browser conversation → requirements → spec → build → QA → deployment, with real/demo provider badges
- Controlled real SpiceRoute path: Discover review → Sarvam/Vobiz outbound call → correlated post-call result → OpenAI configuration edit → QA → Vercel
- PostgreSQL-backed event cursor and polling SSE feed; a separate in-memory demo event path remains
- Real/demo provider contracts for Places, Freshworks, Sarvam/Vobiz,
  ElevenLabs, OpenAI/Claude/Codex, and deployment
- Governed quote and negotiation-floor calculations outside the language model
- Additive Prisma `Workflow`, `AgentRun`, `SystemControl`, and a PostgreSQL-leased job boundary; Redis is not used
- Four responsive, configuration-driven industry templates and a generated SpiceRoute site
- Deterministic QA rules, provider mapping, transition, pricing, specification, and idempotency tests
- Light and dark themes, responsive navigation, persistent demo state, explicit provider badges, retries, and error visibility

## Architecture

```mermaid
flowchart LR
  Web[AgentFront dashboard] <-->|REST + polling SSE| API[AgentFront API]
  API --> DB[(PostgreSQL workflow, events, jobs)]
  DB --> Worker[Sales + transitional workflow worker]
  Worker --> Legacy[Existing orchestrator and providers]
  Legacy --> Templates[Four industry templates]
  Legacy --> DB
```

This diagram shows the **current PostgreSQL mode**, not the completed AWS design. The API atomically persists accepted continuation work; the worker claims it separately. Current provider-stage execution still uses the legacy orchestrator. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/AWS_DEPLOYMENT.md](./docs/AWS_DEPLOYMENT.md) for the target and gaps.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for boundaries, invariants, and deployment notes.

## Repository layout

```text
apps/
  web/          React founder control center
  api/          REST and SSE boundary
  worker/       PostgreSQL-leased sales and transitional workflow workers
packages/
  database/     Prisma schema and seed data
  integrations/ real/demo provider contracts and adapters
  orchestration/ state machines, idempotency, control-tower interfaces
  scoring/      opportunity and commercial rules
  types/        shared domain/API contracts
  ui/           shared UI boundary
templates/
  restaurant/   config-driven restaurant system
  salon/        config-driven salon system
  garments/     config-driven boutique system
  mechanic/     config-driven workshop system
generated-sites/
  AF-2026-000001/   generated SpiceRoute Kitchen example
scripts/        validation and operational scripts
docs/           product and integration documentation
```

## Quick start

Requirements: Node.js 20.19+ and npm 10+.

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. No external credentials are needed. AgentFront detects missing credentials and activates clearly labelled demo providers.

To run individual services separately:

```bash
npm run dev:api
npm run dev:web
npm run dev:worker
```

The default API URL is `http://localhost:4000`. The web demo remains usable if the API is not running so a product walkthrough cannot be blocked by infrastructure.

## Controlled SpiceRoute sales-to-site demo

This path deliberately keeps one founder approval before a real phone call. All
steps after a validated won call are worker-driven. The call target is restricted
to the configured, consented SpiceRoute demo number.

1. Open **Discover**.
2. Keep `Restaurant`, `Sholinganallur, Chennai`, and `5 km`, then select **Search market**.
3. Select **SpiceRoute Kitchen**, which has no website and scores 91/100.
4. Open its intelligence view and select **Approve & call with Sarvam**.
5. Confirm the real call during the configured `10:00–19:00 Asia/Kolkata` window.
6. Complete the conversation as the opted-in owner. Sarvam must return the
   required post-call fields and an explicit `WON` result at exactly ₹7,200.
7. Watch Sales Operations. AgentFront validates the callback, creates the
   specification, invokes OpenAI once on the existing restaurant template,
   runs deterministic QA, and deploys through Vercel automatically.
8. Open the recorded live URL from Deployments.

Before using this path, configure `.env` from
[docs/SARVAM_SALES_AGENT.md](./docs/SARVAM_SALES_AGENT.md), install
`cloudflared`, and start with `npm run dev:sarvam`. The call button stays locked
unless the public callback resolves to this AgentFront API. Starting the same
lead twice is protected by state guards and idempotency keys.

See [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) for the narrated walkthrough.
See [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) for zero-credential, PostgreSQL, hybrid, and real-provider setup.

## Lifecycle

```text
DISCOVERED → QUALIFIED → CRM_CREATED → OUTREACH_READY
→ CONVERSATION_ACTIVE → REQUIREMENTS_COLLECTED → NEGOTIATING
→ DEAL_WON → SPEC_GENERATED → BUILD_QUEUED → BUILDING
→ QA → DEPLOYING → DEPLOYED
```

Terminal and recovery states include `REJECTED`, `NOT_INTERESTED`, `FOLLOW_UP`, `DEAL_LOST`, `BUILD_FAILED`, and `DEPLOY_FAILED`. Transitions are allow-listed and append an event with lead, campaign, project, actor, timestamp, status, duration, and metadata.

## Demo mode and real providers

Each external boundary chooses a provider at runtime:

| Capability | Real provider | Credential-free provider |
| --- | --- | --- |
| Discovery | Google Places | Seeded Chennai market |
| CRM | Freshworks CRM | Local Demo CRM |
| Sales telephony | Sarvam Voice Agents + Vobiz | Explicit demo telephony |
| Browser conversation (legacy) | ElevenLabs realtime | Scripted demo conversation |
| Development | Claude bounded template customizer or restricted Codex CLI | Deterministic build event simulator |
| Deployment | Configured deployment provider | Demo deployment record |

Provider selection is surfaced in Settings and on pipeline stages with `REAL` or `DEMO` badges. A mock URL is explicitly identified as simulated.

## Environment variables

Copy `.env.example`; never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Optional PostgreSQL connection string; when absent the API uses the credential-free in-memory demo store |
| `REDIS_URL` | Reserved connection string for the future distributed queue; Stage‑1 does not consume it |
| `HOST` | API bind host; defaults to loopback-only `127.0.0.1` |
| `PORT` | API port; defaults to `4000` |
| `WEB_ORIGIN` | Browser origin allowed by the API CORS policy |
| `AGENTFRONT_OUTPUT_ROOT` | Optional runtime build root; blank uses ignored `.agentfront-runtime/generated-sites` |
| `AGENTFRONT_API_TOKEN` | Founder access token; required for non-loopback binds and production by default |
| `AGENTFRONT_SESSION_SECRET` | Optional independent HMAC key for the HttpOnly founder session; otherwise derived from the API token |
| `ALLOW_UNAUTHENTICATED_LOOPBACK_DEMO` | Explicit production-mode bypass for a loopback-only demo; never use on an exposed deployment |
| `AGENTFRONT_HEALTH_TTL_MS` | Cache/coalescing interval for authenticated provider diagnostics |
| `VITE_API_BASE_URL` | Optional public API base URL used by the browser build |
| `GOOGLE_PLACES_API_KEY` | Server-only Places API (New) and Geocoding key; never expose it through a `VITE_` variable |
| `FRESHWORKS_DOMAIN` | Freshsales tenant domain |
| `FRESHWORKS_API_KEY` | server-only Freshworks API key |
| `ELEVENLABS_API_KEY` | server-only conversation API key |
| `ELEVENLABS_AGENT_ID` | governed sales agent ID |
| `ELEVENLABS_TOOL_SECRET` | separate server-only Bearer secret for governed REAL conversation completion; never reuse the API key |
| `TELEPHONY_PROVIDER` | set `sarvam` for the controlled SpiceRoute outbound-call adapter |
| `DEMO_BUSINESS_PHONE` | explicitly consented private call destination; never sourced from the seeded listing |
| `DEMO_PUBLIC_BUSINESS_PHONE` | optional for calling; separately allowlisted website phone required only for a later build handoff |
| `SARVAM_*` | server-only Sarvam app, Vobiz connection and correlated HTTPS callback configuration |
| `DEVELOPER_PROVIDER` | set `claude` for bounded existing-template customization |
| `ANTHROPIC_API_KEY` | server-only Claude API key |
| `CODEX_ENABLED` | permits the restricted local provider |
| `DEPLOY_PROVIDER` | deployment adapter selector |
| `DEPLOY_TOKEN` | server-only provider token |
| `VERCEL_TEAM_ID` | optional Vercel team ID/slug; the token must be authorized for it |
| `DEMO_MODE` | Leave unset for automatic per-provider selection; set `true` only to force all demo adapters |
| `GLOBAL_EMERGENCY_STOP` | Server-side stop that prevents new PostgreSQL-backed worker activity when `true` |

The frontend receives only public status and, after explicit consent, a short-lived ElevenLabs signed URL from a `no-store` response. Signed URLs are held only long enough to initialize the SDK and are never written to the lead aggregate. Provider secrets, Codex authentication, and deployment tokens remain server-side.

Real adapters activate independently when their required server-side configuration is present; a missing capability falls back to its labelled demo adapter. `DEMO_MODE=true` is an explicit global override, not a prerequisite for demo fallback. `/api/health` is a cheap public liveness check; active provider and persistence diagnostics are cached, coalesced, and founder-authenticated at `/api/integrations/health`. The browser exchanges `AGENTFRONT_API_TOKEN` once for a signed `HttpOnly`, `SameSite=Strict` session cookie and never stores the raw token. Bearer authentication remains available for trusted non-browser clients. Non-loopback binds and production fail closed without a token; only an explicit loopback demo bypass relaxes production authentication.

## Integrations

### Google Places

Discover renders with Leaflet and free OpenStreetMap tiles, so it needs no browser map key. The required OpenStreetMap attribution remains visible; use a managed OpenStreetMap-compatible tile provider for high-volume production traffic. `GOOGLE_PLACES_API_KEY` is optional and server-only: enable Places API (New) plus Geocoding API, restrict the key to the API server, and never copy it into a `VITE_` variable. Discovery uses supported Google endpoints and never scrapes Search HTML. Without the server key, discovery uses the labelled 32-record demo market.

### Freshworks

The adapter maps an AgentFront lead into an account, contact, deal, stage, and notes. The AgentFront ID is the external correlation key. Stage guards and in-process idempotency maps protect ordinary retries. A production rollout must also reconcile by that correlation key after a process crash before repeating a provider create.

### ElevenLabs

REAL mode uses the official `@elevenlabs/react` provider API. Background orchestration records a pending conversation without minting credentials. Once the founder explicitly consents to microphone access and transcription, the authenticated `POST /api/leads/:leadId/conversation/session` route returns a short-lived signed URL with `Cache-Control: no-store`; the SDK's actual conversation ID is then verified against the configured agent and bound through the API. Live status, speaking/listening mode, transcript, mute, and end controls come from the SDK. Seeded transcript content is shown only in labelled DEMO mode.

Pricing is never delegated to the voice model. A REAL call can advance only when `POST /api/leads/:leadId/conversation/complete` receives a policy-approved structured outcome, the exact bound provider conversation ID, and `Authorization: Bearer <ELEVENLABS_TOOL_SECRET>`. Server-side negotiation still calculates the executable quote, discount, and floor from campaign policy.

Operator setup is still required for automatic post-call progression: configure a trusted ElevenLabs server tool, or an adapter fed by the official post-call webhook, to normalize the provider result and invoke that completion route. This repository does not claim an ElevenLabs webhook receiver or fabricate webhook verification. Until that external setup exists, the REAL browser call is interactive and correlated, but the pipeline intentionally remains at `CONVERSATION_ACTIVE` after the call.

For production, serve the browser and API same-site so the built-in founder session protects REST and SSE consistently, and rotate both the API token and optional session signing secret through your secret manager. Do not place `AGENTFRONT_API_TOKEN`, `ELEVENLABS_API_KEY`, or `ELEVENLABS_TOOL_SECRET` in browser configuration.

### OpenAI, Claude and Codex

The preferred controlled demo provider is OpenAI through the Responses API. It receives the approved
`project_spec.json` and the selected template's existing
`business.config.json`, then may return only a bounded replacement
configuration. Repository creation, QA and deployment remain deterministic
code. Set `DEVELOPER_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL`. Claude remains an optional legacy API provider, and Codex CLI remains a legacy local fallback.

The optional Codex provider invokes `codex exec` inside the copied project
directory. Its `workspace-write` mode is write containment, not tenant read
isolation; production multi-tenant builds require a dedicated container or OS
sandbox with only that project mounted and a minimal environment.

### Deployment

Deployment is behind a provider contract. QA must pass before the orchestrator can enter `DEPLOYING`. The included demo provider records a clearly simulated URL; configure a real adapter and token for live publication.

## Client template system

Templates are complete websites rather than prompt scaffolds. `business.config.json` controls copy, contact details, theme, enabled sections, and purchased features. OpenAI is the preferred bounded configuration editor for the controlled flow; Codex remains an optional legacy provider for approved requirements that exceed deterministic configuration changes.

The generated example is available at `generated-sites/AF-2026-000001/index.html` and includes:

- Home, menu, gallery, and contact content
- WhatsApp ordering and Google Maps affordances
- no reservations feature, because it was not purchased
- generated brand-neutral photography stored locally in the repository
- `project_spec.json` plus a deterministic QA report

## Data and local services

The default quick start leaves `DATABASE_URL` blank and uses the in-memory demo store. To enable durable PostgreSQL persistence, start the local services and set the Docker connection URL in `.env`:

```bash
docker compose up -d postgres
# Set DATABASE_URL=postgresql://agentfront:agentfront@localhost:5432/agentfront in .env
npm run db:migrate
npm run db:seed
npm run dev
```

The Compose file also includes Redis for future queue work, but the current
worker does not consume it and does not require `REDIS_URL`. When
`DATABASE_URL` is present, `npm run dev` starts the PostgreSQL-backed worker
alongside the API and web app. Use the individual `dev:*` commands only when
you intentionally want separate terminals.

The migrations include the original schema plus additive payment and Phase 1 control-tower tables. `npm run db:seed` loads the demo businesses and Stage‑1 campaign. `npm run db:generate` regenerates the client; reserve `npm run db:push` for disposable local schema iteration.

With `DATABASE_URL` configured, the API uses PostgreSQL for reference data, lead aggregates, transitions, events, workflows, agent attempts, and leased jobs. Without it—or when `DEMO_MODE=true` explicitly forces the demo—the API uses an in-memory store. Authenticated `/api/integrations/health` reports the selected persistence mode; an unreachable configured database is reported as degraded, not silently replaced by memory. PostgreSQL-backed API continuation is claimed by a separate worker, but legacy provider-stage side effects still require reconciliation before horizontal production scaling.

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Or run all gates:

```bash
npm run qa
```

Tests cover scoring, state transitions, pricing floors, schema validation, mappings, adapters, and duplicate protection. Generated-site QA additionally checks required sections, approved features, placeholders, broken local links, contact integrity, and build output.

## Failure and recovery model

- External calls record started/succeeded/failed events.
- Retryable stages keep their last safe state and expose **Retry**.
- Stage guards reject invalid transitions.
- Repository guards deduplicate repeated starts and transitions; provider adapters use correlation and idempotency keys for ordinary retries.
- In PostgreSQL mode, accepted pipeline continuation is atomically recorded and queued before acknowledgement; the separate worker claims and renews the lease. The in-memory demo still uses an in-process runner.
- An emergency stop prevents new work without erasing state.
- Demo and real provider health are visible before a campaign starts.

PostgreSQL job claiming, event persistence, and a CRM outbox are implemented. SQS/EventBridge adapters, full five-role handlers, provider-specific crash reconciliation, and a deployed/scaled AWS runtime remain roadmap work.

## Screenshots

| Autonomous operations center | Market discovery |
| --- | --- |
| ![AgentFront founder operations center](docs/screenshots/overview.png) | ![AgentFront map-based market discovery](docs/screenshots/discovery.png) |

| Pipeline visualizer | Live sales intelligence |
| --- | --- |
| ![AgentFront lifecycle state machine](docs/screenshots/pipeline.png) | ![AgentFront realtime transcript and requirement extraction](docs/screenshots/sales-room.png) |

![Generated SpiceRoute client website](docs/screenshots/client-website.png)

For the controlled real path, inspect SpiceRoute in Discover and approve its
Sarvam call once; a validated won callback then advances OpenAI, QA and Vercel
without another UI action. The legacy browser walkthrough remains explicitly
simulated.

## Roadmap

- Durable queue execution with Redis/BullMQ and resumable distributed locks
- Google Maps territory polygons and saved territory views
- Human approval thresholds for high-discount or regulated campaigns
- Broader telephony-provider coverage and production call reconciliation
- Multiple deployment vendors and DNS automation
- Template versioning, visual regression tests, and Lighthouse gates
- Multi-tenant RBAC, audit export, SSO, billing, and per-tenant encryption
- Fully automatic processing with call windows, rate limits, and consent policy enforcement

## License

Copyright © 2026. All rights reserved unless a license is added by the repository owner.
