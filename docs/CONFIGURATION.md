# Configuration and run guide

AgentFront can run as a zero-credential demo, a durable PostgreSQL-backed demo, or a hybrid/real provider deployment. Provider selection is capability-by-capability unless `DEMO_MODE=true` explicitly forces every provider and persistence into the credential-free demo.

## Fastest local demo

Requirements: Node.js 20.19+ and npm 10+.

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. `npm run dev` starts both the API on port 4000 and the web console on port 3000. No credentials are needed. Keep `DATABASE_URL`, `AGENTFRONT_API_TOKEN`, and all provider credentials blank.

In the console:

1. Open **Discover**.
2. Search `Restaurant` in `Sholinganallur, Chennai` with a 5 km radius.
3. Select the clearly labelled demo record **SpiceRoute Kitchen**.
4. Select **Start autonomous pipeline**.
5. Watch CRM, scripted conversation, requirements, governed ₹7,200 agreement, build, deterministic QA, simulated deployment, and booked revenue complete automatically.

The in-memory store resets when the API restarts. The checked-in generated website is a bundled verified example; runtime pipeline builds are written beneath the ignored `.agentfront-runtime/generated-sites/` directory.

## Durable local demo with PostgreSQL

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Set only this database value in `.env`:

```env
DATABASE_URL=postgresql://agentfront:agentfront@localhost:5432/agentfront
```

Leave `DEMO_MODE` blank so the database remains active while missing external credentials independently select demo providers. Then initialize and run:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

This persists campaigns, discovered businesses, lead aggregates, transitions, events, projects, deployments, revenue, and the canonical project sequence across API restarts.

## Founder authentication

Local loopback development may leave `AGENTFRONT_API_TOKEN` blank. Non-loopback binds and production require it by default.

```env
AGENTFRONT_API_TOKEN=replace-with-a-long-random-secret
AGENTFRONT_SESSION_SECRET=replace-with-an-independent-long-random-secret
```

When a token is configured, the web console shows a login gate. The token is exchanged once for a signed HttpOnly session cookie and is not stored in browser storage. `AGENTFRONT_SESSION_SECRET` is recommended but optional; when blank, the server derives a signing key from the API token.

Never enable `ALLOW_UNAUTHENTICATED_LOOPBACK_DEMO=true` on an exposed service. It exists only for an intentional production-mode process still bound to loopback.

## Optional provider configuration

Each row activates independently. Missing configuration keeps only that capability in labelled `DEMO` mode.

| Capability | Required configuration | Operator setup |
| --- | --- | --- |
| Server discovery | `GOOGLE_PLACES_API_KEY` | Enable Places API (New) and Geocoding API; restrict the key to the API server and those APIs. |
| Browser map | None by default; optional `VITE_MAP_TILE_URL` and `VITE_MAP_TILE_ATTRIBUTION` | Discover uses Leaflet with free OpenStreetMap tiles; retain the required OpenStreetMap attribution and use a managed tile provider for high-volume production traffic. |
| CRM | `FRESHWORKS_DOMAIN`, `FRESHWORKS_API_KEY` | Create/map the expected Freshsales deal stages, including Qualified, Negotiating, Deal Won, and Deployed. |
| Realtime conversation | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_TOOL_SECRET` | Configure the ElevenLabs agent and a trusted server tool/post-call adapter that submits the governed completion with the separate tool secret. |
| Development | `CODEX_ENABLED=true` | Install and authenticate the Codex CLI on the API host. For multi-tenant production, run it in a container/OS sandbox; `workspace-write` is not a read-isolation boundary. |
| Deployment | `DEPLOY_PROVIDER=vercel`, `DEPLOY_TOKEN` | Install the Vercel CLI and provide a scoped token. Reconcile by AgentFront project ID after a process crash before repeating a deployment. |

Example hybrid configuration:

```env
DATABASE_URL=postgresql://agentfront:agentfront@localhost:5432/agentfront
AGENTFRONT_API_TOKEN=replace-me
AGENTFRONT_SESSION_SECRET=replace-me-separately

GOOGLE_PLACES_API_KEY=

FRESHWORKS_DOMAIN=
FRESHWORKS_API_KEY=

ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_TOOL_SECRET=

CODEX_ENABLED=false
DEPLOY_PROVIDER=demo
DEPLOY_TOKEN=

# Keep blank for independent provider selection.
DEMO_MODE=
```

Restart `npm run dev` after changing server-side provider configuration. Settings reports each adapter as `REAL`, `DEMO`, `DEGRADED`, or `NOT_CONFIGURED`; a configured Google key is not labelled connected until a real search succeeds.

## Getting the optional API credentials

You do not need a map key: Discover uses Leaflet with free OpenStreetMap tiles and retains the required attribution. The public OpenStreetMap tile service is appropriate for local development and light traffic; arrange a managed OpenStreetMap-compatible tile provider before sustained production traffic. When you do, set its tile template in `VITE_MAP_TILE_URL` and its required visible credit in `VITE_MAP_TILE_ATTRIBUTION`.

Use this order for the integrations you want to make real. Leave every other value blank; AgentFront will keep that specific capability in visibly labelled demo mode.

1. **PostgreSQL (recommended first):** run `docker compose up -d postgres`, then set `DATABASE_URL=postgresql://agentfront:agentfront@localhost:5432/agentfront`, run `npm run db:migrate` and `npm run db:seed`.
2. **Founder login:** generate two independent secrets, for example with `openssl rand -hex 32`, and paste them into `AGENTFRONT_API_TOKEN` and `AGENTFRONT_SESSION_SECRET`. Restarting the app shows the founder login gate.
3. **Google business discovery (optional):** in Google Cloud Console create a project, enable **Places API (New)** and **Geocoding API**, create one server key, restrict it to those APIs and to the API server's outbound IP address, then paste it into `GOOGLE_PLACES_API_KEY`. Do not place it in a `VITE_` variable. Google documents API-key creation and restrictions at [Get an API key](https://developers.google.com/maps/documentation/javascript/get-api-key).
4. **Freshworks CRM (optional):** in Freshworks CRM open your avatar → **Profile Settings** → **API Settings**. Copy the API key and bundle/domain alias. Use the domain without `https://`, for example `acme.myfreshworks.com`, in `FRESHWORKS_DOMAIN`; paste the key into `FRESHWORKS_API_KEY`. Map the tenant's deal stages listed in the integration guide before the first live lead. See [Freshworks CRM API authentication](https://developers.freshworks.com/crm/api/).
5. **ElevenLabs sales calls (optional):** create an account, open **Developers → API Keys** to create a restricted key, create a Conversational AI agent and copy its agent ID. Paste them into `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`; generate a separate random `ELEVENLABS_TOOL_SECRET` for your trusted server tool or post-call adapter. Keep all three values server-side. ElevenLabs recommends signed URLs for browser calls and documents the flow at [Agent authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication). A real call intentionally stays at `CONVERSATION_ACTIVE` until that trusted tool/adapter posts the governed completion.
6. **Codex development (optional):** install and authenticate the Codex CLI on the API host, then set `CODEX_ENABLED=true`. Keep this false for the deterministic demo builder. Production multi-tenant work needs an OS/container sandbox around each build.
7. **Vercel deployment (optional):** create a scoped Vercel account token under Account Settings → Tokens, install the Vercel CLI on the API host, then set `DEPLOY_PROVIDER=vercel` and `DEPLOY_TOKEN=...`. Vercel documents token creation at [using an API access token](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token).

After any change, restart `npm run dev`, sign in if you configured the founder token, then open **Settings → Integrations**. A capability is ready only when it reports `REAL · CONNECTED`; a configured but unreachable adapter is shown as `DEGRADED` and is not silently replaced with demo data.

## Useful commands

```bash
npm run dev          # API + web
npm run dev:api      # API only
npm run dev:web      # web only
npm run dev:worker   # local typed-job scaffold; not a Redis consumer
npm run qa           # lint, types, tests, generated-site QA, production build
npm run qa:site      # validate the checked-in SpiceRoute example
```

Stop local PostgreSQL without deleting its volume:

```bash
docker compose stop postgres
```

The Stage‑1 background runner is single-process. Operate one orchestrating API replica until Redis/BullMQ claims, a transactional outbox, and durable provider reconciliation are implemented.
