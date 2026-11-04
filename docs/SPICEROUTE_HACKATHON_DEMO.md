# SpiceRoute Kitchen hackathon demo

This is the one approved panel demonstration. It shows one consented business
moving through five bounded product roles. It does not claim that a browser
conversation is an Indian phone call, that an ad preview was published, or that
a Dodo test transaction is revenue.

## What the five roles do

1. **Discover** selects and scores SpiceRoute Kitchen.
2. **Sales** uses Sarvam Voice Agents through the configured Vobiz connection to
   call only the opted-in founder demo number after one explicit review click.
   Sarvam extracts the confirmed scope and exact INR price after the call.
3. **Developer** copies the existing restaurant template into an isolated
   project workspace; Claude changes only its validated configuration using the
   approved requirements. QA then validates the result.
4. **Advertise** renders animated Instagram Reels, Google Search and YouTube
   concepts. They remain explicitly unpublished previews.
5. **Deliver** exposes the verified Vercel URL and creates a single-use Dodo
   test checkout. Payment appears only after a signed `payment.succeeded`
   webhook; the worker then adds a test-payment note to the real Freshworks
   deal.

## Provider configuration

Start with PostgreSQL and leave `DEMO_MODE` blank. Configure the server-only
values documented in `.env.example` for Freshworks, Sarvam/Vobiz, Claude,
Vercel and Dodo test mode. Keep `DEMO_BUSINESS_PHONE` private. Configure the
separate `DEMO_PUBLIC_BUSINESS_PHONE` only for a number the owner explicitly
permits AgentFront to publish on the generated site.

Create and commit the single-state Sarvam agent exactly as documented in
`SARVAM_SALES_AGENT.md`. Install `cloudflared`; `npm run dev:sarvam` creates a
fresh restricted callback tunnel and starts the API, worker and web app with the
callback injected. The flow fails closed when that callback is unreachable.

Set `DEVELOPER_PROVIDER=openai` and provide `OPENAI_API_KEY`. OpenAI is not
asked to invent a site or deploy it. AgentFront supplies one selected existing
template and accepts only a schema-compatible `business.config.json`; normal
code handles QA and Vercel.

For Dodo, create a test-mode one-time product for the exact accepted deal
(₹100 is `720000` paise), register the public HTTPS webhook endpoint
`POST /api/webhooks/dodo-test`, and subscribe to `payment.succeeded`. Never put
the API or webhook key in a `VITE_` variable.

## Run it

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:sarvam
```

Open `http://localhost:3000/#/discover` and confirm Settings reports PostgreSQL,
Sarvam, OpenAI, the worker and Vercel as connected. Inspect SpiceRoute, select
**Approve & call with Sarvam**, and confirm once. This action is allowed only
from 10:00–19:00 IST. Complete the live call as the owner and explicitly confirm
the ₹100 scope plus the configured public business phone. The verified Sarvam
webhook then creates the specification and queues OpenAI → QA → Vercel without
another click. Follow the real state in Sales Operations, Pipeline, Activity and
Deployments.

After the real Vercel URL appears, the optional Dodo **TEST** checkout can be
created from the demo page. Payment and Freshworks sync update only from the
signed webhook/worker state.

The ad cards are panel-ready creative previews. Publishing real Google, YouTube
or Instagram campaigns remains outside this demo and requires separate platform
approval, credentials, budgets and stop rules.
