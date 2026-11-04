# Integration operations guide

All credentials belong in the API or worker environment. The web application receives provider health and mode only.

## API access and provider selection

The API binds to `127.0.0.1` by default. Loopback development may omit `AGENTFRONT_API_TOKEN`; set a strong token before changing `HOST` to `0.0.0.0`, a LAN address, or another non-loopback interface. Production requires authentication even on loopback unless `ALLOW_UNAUTHENTICATED_LOOPBACK_DEMO=true` is explicitly set for a loopback-only demonstration. `/api/health` is a cheap public liveness route. `/api/integrations/health` and all operational routes require a valid founder session or Bearer token. The web app exchanges the token through `/api/auth/session` for a signed HttpOnly cookie and does not persist the raw token. Invalid credentials return HTTP 401; an auth-required service without a token fails closed with HTTP 503.

Leave `DEMO_MODE` unset for automatic, capability-by-capability selection. A real adapter activates when its required credentials/configuration are present, while an unconfigured capability uses its labelled demo provider. Set `DEMO_MODE=true` only when you intentionally want to force every capability into demo mode despite available credentials.

## Google Places discovery and OpenStreetMap display

Discover's interactive map is Leaflet with free OpenStreetMap tiles; it requires no browser API key. The visible attribution must remain. For high-volume production traffic, use an OpenStreetMap-compatible managed tile service in accordance with its policy rather than relying on the public tile service.

- Enable Places API (New) plus Geocoding API only when you want live Google business discovery.
- Keep `GOOGLE_PLACES_API_KEY` server-only (never in a `VITE_` variable) and restrict it to the API's egress environment and the two server APIs.
- Configure quota alarms before automatic campaign processing.
- Store Google place IDs as external correlation IDs; do not scrape search pages.

The repository-root `.env` is also the Vite environment directory. The map remains available without Google credentials. The data-provider badge is independent: the OpenStreetMap view can display explicitly labelled demo businesses when the server Places provider is not configured.

If configuration is missing or the health check fails, discovery switches to the labelled Demo Places provider. A provider failure during a real campaign is surfaced as an error and is not silently represented as live data.

## Freshworks CRM

Map AgentFront states to tenant-specific stages during setup. The default lifecycle is Qualified, Contact Ready, Contacted, Interested, Requirements Collected, Negotiating, Deal Won, Building, QA, Deployed, and Lost.

All create calls carry the AgentFront ID and use in-process idempotency keys. Returned account/contact/deal IDs are persisted before moving the lead forward. After an API crash during a provider call, operators must reconcile by the AgentFront correlation before retrying because a durable provider reconciliation ledger is not yet implemented. Notes should contain concise lifecycle facts rather than raw provider secrets or full private transcripts.

## Sarvam Voice Agents and Vobiz

The reviewed sales path uses Sarvam Instant Outbound with its configured
Vobiz connection. It is deliberately founder-triggered: the founder must inspect
a qualified record, confirm its exact Google Places phone, and press the Sarvam
call button. No discovery or queue event auto-dials. The call must also satisfy
server-side calling-hour, retry and do-not-contact policy, and the public HTTPS
callback must reach AgentFront before dialing. Keep
`SARVAM_ALLOW_DISCOVERED_DESTINATIONS=false` for the single-number demo; set it
to `true` only for this reviewed Google Places destination flow.

The post-call route verifies its opaque callback token and correlates the
attempt, business and call IDs with PostgreSQL before accepting the transcript
and final agent variables. The local `dev:sarvam` launcher generates a fresh
process-only token on every run; a persistent deployment must supply the same
kind of secret from its secret manager. A validated won result persists the
accepted specification and enqueues the developer stage. See
[SARVAM_SALES_AGENT.md](./SARVAM_SALES_AGENT.md) for the exact single-state
agent, variable and local-tunnel setup. This integration is separate from the
legacy browser conversation below.

## ElevenLabs (legacy browser conversation)

The REAL browser session uses `@elevenlabs/react` with a short-lived server-authorized WebSocket flow:

1. Background orchestration creates only a pending logical conversation. It does not request, persist, or return a signed URL.
2. In the Sales Room, the user explicitly consents to microphone processing and transcription and grants browser microphone permission.
3. The authenticated `POST /api/leads/:leadId/conversation/session` route issues a just-in-time signed URL in a `no-store` response. Replays are bounded by a short-lived in-memory idempotency grant; general lead GETs always redact credential fields.
4. The React SDK reports the actual provider conversation ID through `onConnect`. `POST /api/leads/:leadId/conversation/connect` verifies that conversation belongs to `ELEVENLABS_AGENT_ID` before persisting only the provider ID.
5. The browser renders SDK status, speaking/listening mode, live messages, mute, and end-session controls. It never renders seeded transcript content in REAL mode.

The configured agent may discover needs, but cannot set an executable deal amount. Backend negotiation resolves the campaign's package range, permitted discount, and floor. REAL completion requires the exact bound provider ID plus a separate `ELEVENLABS_TOOL_SECRET`; the general AgentFront API token is not accepted as tool authorization.

Automatic completion is an operator integration step. Configure either an ElevenLabs server-side tool that posts the governed outcome to `/api/leads/:leadId/conversation/complete`, or a trusted adapter that receives and verifies the official ElevenLabs post-call webhook and then calls that endpoint. Keep `ELEVENLABS_TOOL_SECRET` only in the provider/trusted adapter secret store. AgentFront intentionally does not expose an unverifiable generic webhook endpoint, and REAL orchestration remains parked at `CONVERSATION_ACTIVE` until this callback succeeds.

Production browser access uses AgentFront's same-site HttpOnly founder session. Never solve API authentication by embedding `AGENTFRONT_API_TOKEN` in Vite/browser variables.

Record customer consent and calling-window policy before enabling telephony adapters. Stage‑1 browser conversation does not require Twilio or Exotel.

## OpenAI, Claude and Codex

The controlled SpiceRoute developer path selects the existing restaurant
template and sends only its validated project specification and current
`business.config.json` to OpenAI. The response must match the baseline JSON
shape and value types exactly, remain within size/depth limits, and contain no
executable content. AgentFront writes that bounded configuration, then normal
code runs QA and deployment. OpenAI does not create repositories, run commands
or deploy the site.

The legacy Codex CLI adapter remains optional. The orchestrator checks that
`codex` exists and is enabled, copies an allow-listed template into an
ownership-bound child of the ignored runtime build root, writes the validated
specification, and starts Codex with a fixed instruction and working directory.
Do not expose a general shell endpoint. `workspace-write` constrains writes but
does not prevent reads of other host-visible files, so it is not a tenant
boundary.

Recommended production controls:

- one OS/container identity per build
- read-only template source
- project-specific writable volume
- network policy and execution timeout
- CPU/memory limits
- stdout/stderr size and redaction limits
- artifact and dependency scanning before deployment

## Deployment

Deployment remains behind `DeploymentProvider`. The current real adapter runs
the Vercel CLI with a server-only scoped token only after deterministic QA
passes; the demo adapter records a visibly simulated URL. Store the provider
deployment ID and public URL separately. Before horizontal production scaling,
a retry must reconcile an existing remote operation by AgentFront project and
version rather than creating a duplicate deployment.
