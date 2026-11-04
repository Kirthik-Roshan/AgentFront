# Configuration and run guide

AgentFront can run as a zero-credential demo or a durable PostgreSQL-backed hybrid. Provider selection is capability-by-capability unless `DEMO_MODE=true` forces the configured providers into labelled demo mode. `DEMO_MODE` does **not** disable PostgreSQL when `DATABASE_URL` is set.

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
4. Use the guided pipeline action to see the legacy simulated flow. This is a browser/local demo, not evidence of cloud autonomy or a real phone call.

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

Leave `DEMO_MODE` blank for capability-by-capability provider selection. Then
initialize and run the API, durable worker and web app together:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

When `DATABASE_URL` is configured, `npm run dev` includes the separate worker.
This persists campaigns, businesses, lead aggregates, workflows, events, agent
attempts, jobs, projects, deployments and revenue. Accepted PostgreSQL
continuation work waits in the job table until a worker is running; closing the
dashboard does not stop that worker process.

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
| Operational support | `FRESHDESK_DOMAIN`, `FRESHDESK_API_KEY`, `FRESHDESK_REQUESTER_EMAIL` | Separate Freshdesk helpdesk account. The adapter and health check exist, but automatic exception-ticket dispatch is not wired yet. |
| Sales call | `TELEPHONY_PROVIDER=sarvam`, `DEMO_BUSINESS_PHONE`, and the server-only `SARVAM_*` values | Commit the single-state Sarvam agent, connect Vobiz, and keep a public callback alive. Set `SARVAM_ALLOW_DISCOVERED_DESTINATIONS=true` only when the founder-reviewed Discover button should dial the selected Google Places phone. |
| Realtime conversation (legacy) | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_TOOL_SECRET` | Optional browser conversation; it is not the SpiceRoute PSTN sales path. |
| Development | DEVELOPER_PROVIDER=openai, OPENAI_API_KEY, optional OPENAI_MODEL | OpenAI may update only the selected template validated business.config.json. Claude and Codex CLI remain optional legacy providers. |
| Deployment | `DEPLOY_PROVIDER=vercel`, `DEPLOY_TOKEN`, optional `VERCEL_TEAM_ID` | Install the Vercel CLI and provide a token authorized for the selected personal/team scope. Reconcile by AgentFront project ID after a process crash before repeating a deployment. |
| Test checkout | `DODO_PAYMENTS_ENVIRONMENT=test_mode` plus the six `DODO_*` values in `.env.example` | Create a Dodo **test-mode** one-time product whose price exactly matches the accepted deal and register `POST /api/webhooks/dodo-test` as its HTTPS webhook. PostgreSQL, a won deal, and a real deployment are mandatory. |

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

TELEPHONY_PROVIDER=sarvam
DEMO_BUSINESS_PHONE=
DEMO_PUBLIC_BUSINESS_PHONE=
SARVAM_API_KEY=
SARVAM_ORG_ID=
SARVAM_WORKSPACE_ID=
SARVAM_SALES_APP_ID=
SARVAM_SALES_APP_VERSION=
SARVAM_CONNECTION_ID=
SARVAM_AGENT_PHONE_NUMBER=
SARVAM_WEBHOOK_TOKEN=
SARVAM_ALLOWED_BUSINESS_ID=business-spiceroute
SARVAM_ALLOW_DISCOVERED_DESTINATIONS=false

DEVELOPER_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-astra
# Optional legacy provider
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-6
CODEX_ENABLED=false
DEPLOY_PROVIDER=demo
DEPLOY_TOKEN=
VERCEL_TEAM_ID=

DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_WEBHOOK_KEY=
DODO_TEST_PRODUCT_ID=
DODO_TEST_BUSINESS_ID=
DODO_TEST_EXPECTED_AMOUNT_MINOR=10000
DODO_TEST_RETURN_URL=http://localhost:3000/#/demo

# Keep blank for independent provider selection.
DEMO_MODE=
```

Restart the active launcher after changing server-side provider configuration.
Use `npm run dev:sarvam` rather than `npm run dev` for the real reviewed-call
path so the process receives a fresh public callback. Settings reports each
adapter as `REAL`, `DEMO`, `DEGRADED`, or `NOT_CONFIGURED`; a configured Google
key is not labelled connected until a real search succeeds.

## Getting the optional API credentials

You do not need a map key: Discover uses Leaflet with free OpenStreetMap tiles and retains the required attribution. The public OpenStreetMap tile service is appropriate for local development and light traffic; arrange a managed OpenStreetMap-compatible tile provider before sustained production traffic. When you do, set its tile template in `VITE_MAP_TILE_URL` and its required visible credit in `VITE_MAP_TILE_ATTRIBUTION`.

Use this order for the integrations you want to make real. Leave every other value blank; AgentFront will keep that specific capability in visibly labelled demo mode.

1. **PostgreSQL (recommended first):** run `docker compose up -d postgres`, then set `DATABASE_URL=postgresql://agentfront:agentfront@localhost:5432/agentfront`, run `npm run db:migrate` and `npm run db:seed`.
2. **Founder login:** generate two independent secrets, for example with `openssl rand -hex 32`, and paste them into `AGENTFRONT_API_TOKEN` and `AGENTFRONT_SESSION_SECRET`. Restarting the app shows the founder login gate.
3. **Google business discovery (optional):** in Google Cloud Console create a project, enable **Places API (New)** and **Geocoding API**, create one server key, restrict it to those APIs and to the API server's outbound IP address, then paste it into `GOOGLE_PLACES_API_KEY`. Do not place it in a `VITE_` variable. Google documents API-key creation and restrictions at [Get an API key](https://developers.google.com/maps/documentation/javascript/get-api-key).
4. **Freshworks CRM (optional):** in Freshworks CRM open your avatar → **Profile Settings** → **API Settings**. Copy the API key and bundle/domain alias. Use the domain without `https://`, for example `acme.myfreshworks.com`, in `FRESHWORKS_DOMAIN`; paste the key into `FRESHWORKS_API_KEY`. Map the tenant's deal stages listed in the integration guide before the first live lead. See [Freshworks CRM API authentication](https://developers.freshworks.com/crm/api/).
5. **Freshdesk operational support (optional):** obtain a separate Freshdesk API key from its profile settings. Set `FRESHDESK_DOMAIN` to the helpdesk host (for example `acme.freshdesk.com`), `FRESHDESK_API_KEY` to that key, and `FRESHDESK_REQUESTER_EMAIL` to an existing support requester address. The API health check can verify access, but failures are not yet auto-ticketed. Freshdesk documents [API-key authentication and ticket creation](https://developers.freshdesk.com/api/).
6. **Sarvam + Vobiz sales call:** follow [SARVAM_SALES_AGENT.md](./SARVAM_SALES_AGENT.md), commit the single-state agent, connect its Vobiz number, and copy the IDs into `.env`. Install `cloudflared` and use `npm run dev:sarvam`; the launcher creates a fresh process-only webhook token and callback URL on every run, so it does not reuse `SARVAM_WEBHOOK_TOKEN` from `.env`. A manual or persistent deployment must instead generate and secret-manage its own token and matching public callback URL. By default the call is restricted to `DEMO_BUSINESS_PHONE`. To enable reviewed live records, set `SARVAM_ALLOW_DISCOVERED_DESTINATIONS=true`; then only the authenticated **Approve & call with Sarvam** action can use the exact persisted Google Places phone. The `10:00–19:00 Asia/Kolkata` window, retry limits, do-not-call state and callback health check still apply. AgentFront passes the selected business name, category, location and price into Sarvam `agent_variables` for that call.
7. **OpenAI template customization:** set `DEVELOPER_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL`. OpenAI receives the approved call specification and one existing template configuration. Its output must preserve the exact baseline schema and is validated before QA. `CODEX_ENABLED=true` is only the legacy fallback when no API developer provider is selected.
8. **ElevenLabs browser conversation (legacy optional):** configure its three values only when you need the separate browser conversation. It is not used by the Sarvam phone path.
9. **Vercel deployment:** create a Vercel token authorized for the destination account/team, install the Vercel CLI on the worker host, then set `DEPLOY_PROVIDER=vercel`, `DEPLOY_TOKEN=...`, and `VERCEL_TEAM_ID` when deploying to a team. Settings runs a read-only authenticated CLI check; `REAL · DEGRADED` means the token cannot access that scope. The current demo deploys the isolated template workspace directly; GitHub repository automation is not part of this path.
10. **Dodo test checkout (optional):** switch the Dodo dashboard to test mode, create a one-time ₹100 product, and copy its product ID, business ID, test API key, and webhook signing key into the matching `DODO_*` variables. Register the public HTTPS endpoint `POST /api/webhooks/dodo-test`, select `payment.succeeded`, and set the return URL back to the AgentFront demo view. Keep `DODO_PAYMENTS_ENVIRONMENT=test_mode`; this repository deliberately has no live-payment adapter. The checkout button stays locked until PostgreSQL contains the accepted ₹100 deal and a `REAL` Vercel deployment. A browser return is never accepted as proof of payment—the signed webhook is the only authority.

11. **Delivery email with Gmail:** in the same Google Cloud project, enable **Gmail API** separately from Places. Create an OAuth web/desktop client, authorize only `https://www.googleapis.com/auth/gmail.send` with offline access, and store the resulting client ID, client secret and refresh token in `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN`. Set `NOTIFICATION_PROVIDER=gmail` and `GMAIL_SENDER_EMAIL` to the mailbox that granted consent. Sarvam must extract a confirmed `client_email`. After a real deployment the worker creates the Dodo test checkout and emails both links. If any required value is absent, delivery stays pending and no success is fabricated. An API key used by Google Places cannot authorize Gmail because Gmail acts on a user mailbox.

After any change, restart the active launcher, sign in if you configured the
founder token, then open **Settings → Integrations**. For a real Sarvam call,
that launcher must be `npm run dev:sarvam`. A capability is ready only when it
reports `REAL · CONNECTED`; a configured but unreachable adapter is shown as
`DEGRADED` and is not silently replaced with demo data.

## Useful commands

```bash
npm run dev          # API + web; also the worker when DATABASE_URL is set
npm run dev:sarvam   # restricted public callback tunnel + API + worker + web
npm run dev:api      # API only
npm run dev:web      # web only
npm run dev:worker   # separate PostgreSQL-backed sales/workflow/payment worker
npm run qa           # lint, types, tests, generated-site QA, production build
npm run qa:site      # validate the checked-in SpiceRoute example
```

Stop local PostgreSQL without deleting its volume:

```bash
docker compose stop postgres
```

PostgreSQL mode uses a separate worker and durable job leases; it is not an AWS deployment. Provider-specific crash reconciliation, the five target worker handlers, and cloud infrastructure remain unfinished. Do not run multiple production replicas until those effects are safe to retry.
