# AgentFront

**Autonomous business acquisition and digital delivery, operated from one control center.**

AgentFront discovers underserved local businesses, qualifies the commercial opportunity, opens the CRM lifecycle, runs a governed sales conversation, converts the agreement into a validated software specification, builds from an industry template, performs deterministic QA, deploys, and records revenue.

This repository is a production-oriented reference implementation with a complete credential-free Stage‑1 demo. Mocked providers are always labelled `DEMO`; the product never presents seeded data as live provider data.

> AgentFront does not merely generate websites. AgentFront operates the acquisition-to-delivery business around them.

## What is implemented

- Founder operations center with live KPIs, funnel, pipeline revenue, agent activity, and system health
- Map-style business discovery with 32 realistic Chennai businesses across four MVP industries
- Opportunity intelligence, deterministic scoring, and qualification explanations
- A guarded, idempotent lead state machine with a canonical `AF-YYYY-NNNNNN` project identifier
- Complete SpiceRoute Kitchen journey: discovery → CRM → conversation → requirements → negotiation → spec → build → QA → deployment → revenue
- Realtime demo event simulation and an SSE-capable API boundary
- Real/demo provider contracts for Places, Freshworks, ElevenLabs, Codex, and deployment
- Governed quote and negotiation-floor calculations outside the language model
- Normalized Prisma schema for PostgreSQL and a Redis-ready worker boundary
- Four responsive, configuration-driven industry templates and a generated SpiceRoute site
- Deterministic QA rules, provider mapping, transition, pricing, specification, and idempotency tests
- Light and dark themes, responsive navigation, persistent demo state, explicit provider badges, retries, and error visibility

## Architecture

```mermaid
flowchart LR
  Founder[Founder / Operator] --> Web[Founder Control Center]
  Web <-->|REST + SSE| API[AgentFront API]
  API --> O[Orchestrator]
  O --> DB[(PostgreSQL)]
  O --> Places{Places Provider}
  O --> CRM{CRM Provider}
  O --> Voice{Conversation Provider}
  O --> Dev{Developer Provider}
  O --> Deploy{Deployment Provider}

  Places --> GP[Google Places]
  Places --> DP[Demo Places]
  CRM --> FW[Freshworks]
  CRM --> DCRM[Demo CRM]
  Voice --> EL[ElevenLabs]
  Voice --> DV[Demo Conversation]
  Dev --> CX[Codex CLI]
  Dev --> DD[Demo Developer]
  Deploy --> RealDeploy[Vercel / compatible]
  Deploy --> DemoDeploy[Demo Deployment]

  O --> Templates[Industry templates]
  Templates --> Sites[Ownership-bound runtime workspaces]
  Sites --> QA[Deterministic QA]
  QA --> Deploy

  O -. production scaling path .-> Q[(Redis / Durable Queue)]
  Q -.-> Worker[Restricted Worker]
```

Agents never call each other directly. Every action is requested and recorded through the orchestrator. Provider adapters are selected from server-side configuration, and the canonical AgentFront ID follows the record through every integration.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for boundaries, invariants, and deployment notes.

## Repository layout

```text
apps/
  web/          React founder control center
  api/          REST and SSE boundary
  worker/       typed job-boundary scaffold for the future distributed topology
packages/
  database/     Prisma schema and seed data
  integrations/ real/demo provider contracts and adapters
  orchestration/state machine, idempotency, event flow
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

## Stage‑1 demo

1. Open **Discover**.
2. Keep `Restaurant`, `Sholinganallur, Chennai`, and `5 km`, then select **Search market**.
3. Select **SpiceRoute Kitchen**, which has no website and scores 91/100.
4. Open its intelligence view and select **Start autonomous pipeline**.
5. Watch the CRM creation and sales room. Requirements are extracted while the transcript advances.
6. Observe the scripted demo conversation accept the governed ₹7,200 offer (the configured ₹7,200 floor cannot be crossed).
7. Follow the pipeline visualizer while the project spec, template build, QA, deployment, CRM stage, and revenue update automatically.
8. Open the delivered website from the deployment card.

This is the last major manual action in the demo. Starting the same lead twice is protected by stage guards and idempotency keys.

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
| Conversation | ElevenLabs realtime | Scripted demo conversation |
| Development | Restricted Codex CLI | Deterministic build event simulator |
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
| `CODEX_ENABLED` | permits the restricted local provider |
| `DEPLOY_PROVIDER` | deployment adapter selector |
| `DEPLOY_TOKEN` | server-only provider token |
| `DEMO_MODE` | Leave unset for automatic per-provider selection; set `true` only to force all demo adapters |

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

### Codex

The Stage‑1 orchestrator copies a selected template into an ignored runtime workspace below `.agentfront-runtime/generated-sites/`, writes and validates `project_spec.json`, and invokes `codex exec` with an argument array inside that project directory. Customer content is written as data and never interpolated into a shell command. stdout/stderr becomes structured build events. Codex `workspace-write` is write containment, not a tenant read-isolation boundary; production multi-tenant builds require a container or OS sandbox with only the project mounted and a minimal environment.

### Deployment

Deployment is behind a provider contract. QA must pass before the orchestrator can enter `DEPLOYING`. The included demo provider records a clearly simulated URL; configure a real adapter and token for live publication.

## Client template system

Templates are complete websites rather than prompt scaffolds. `business.config.json` controls copy, contact details, theme, enabled sections, and purchased features. Codex is reserved for approved requirements that exceed configuration.

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
npm run dev:api
```

The Compose file also includes Redis for future queue work, but the Stage‑1 worker does not consume it and does not require `REDIS_URL`.

The checked-in initial migration creates the normalized workflow schema; `npm run db:seed` idempotently loads the 32 demo businesses and the Stage‑1 campaign. `npm run db:generate` regenerates the client, and `npm run db:push` is available for disposable local schema iteration.

With `DATABASE_URL` configured, the API uses PostgreSQL for reference data, full lead aggregates, the canonical project sequence, transitions, events, revenue, and transition idempotency records. Without it—or when `DEMO_MODE=true` explicitly forces the demo—the API uses the in-memory store. Authenticated `/api/integrations/health` reports the selected persistence mode; a configured but unreachable database is reported as degraded and is never silently replaced by memory. Workflow execution is currently guarded within one API process, so operate a single orchestrating API replica until distributed job claiming is implemented.

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
- Long-running pipeline, retry, and completion commands are acknowledged before orchestration continues in the guarded Stage‑1 background runner.
- An emergency stop prevents new work without erasing state.
- Demo and real provider health are visible before a campaign starts.

The Stage‑1 background runner is intentionally single-process. Redis/BullMQ claiming, a transactional outbox, provider-specific crash reconciliation, and horizontally scaled workers remain roadmap work.

## Screenshots

| Autonomous operations center | Market discovery |
| --- | --- |
| ![AgentFront founder operations center](docs/screenshots/overview.png) | ![AgentFront map-based market discovery](docs/screenshots/discovery.png) |

| Pipeline visualizer | Live sales intelligence |
| --- | --- |
| ![AgentFront lifecycle state machine](docs/screenshots/pipeline.png) | ![AgentFront realtime transcript and requirement extraction](docs/screenshots/sales-room.png) |

![Generated SpiceRoute client website](docs/screenshots/client-website.png)

Start the demo pipeline to watch the transcript, requirement extraction, accepted offer, build events, QA, and deployment activate in sequence.

## Roadmap

- Durable queue execution with Redis/BullMQ and resumable distributed locks
- Google Maps territory polygons and saved territory views
- Human approval thresholds for high-discount or regulated campaigns
- Call-channel adapters beyond browser realtime sessions
- Multiple deployment vendors and DNS automation
- Template versioning, visual regression tests, and Lighthouse gates
- Multi-tenant RBAC, audit export, SSO, billing, and per-tenant encryption
- Fully automatic processing with call windows, rate limits, and consent policy enforcement

## License

Copyright © 2026. All rights reserved unless a license is added by the repository owner.
