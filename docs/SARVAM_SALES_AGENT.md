# Sarvam sales agent — founder-reviewed outbound

The same committed agent serves the selected AgentFront business. Business identity, category, location and governed price are injected for every approved call; the prompt must never retain a client name or price. With
`SARVAM_ALLOW_DISCOVERED_DESTINATIONS=false`, it may dial only the founder's
explicitly opted-in `DEMO_BUSINESS_PHONE`. When the flag is explicitly `true`,
an authenticated founder may inspect a qualified live Google Places record and
confirm its exact displayed phone using **Approve & call with Sarvam**. Discovery
and queueing never auto-dial. That dial target is private
workflow data and is never published. The generated website may use only the
separate `DEMO_PUBLIC_BUSINESS_PHONE` that the owner explicitly confirms during
requirements collection. That public number is optional for the call-only demo:
leaving it unset does not block the sales call, but it deliberately prevents a
won callback from starting the website build.

## 1. Create the agent

In Sarvam Voice Agents, open **Build → Agents → Create from scratch**.

- Name: `AgentFront Sales`
- Architecture: single-state
- Starting language: English
- Allowed languages: English, Tamil, Hindi
- Automatic/smart language switching: enabled
- Target price: supplied at call time through `target_price`
- Absolute floor: supplied at call time through `floor_price`

Paste the instruction below. Insert Sarvam variable chips for bracketed values;
do not paste API keys or phone numbers into the prompt.

```text
PERSONA
You are Ananya, AgentFront's multilingual digital-sales consultant. Sound direct,
commercially confident and conversational—not scripted, timid or excessively
formal. Use short English, Tamil, Hindi or natural code-mixed sentences that match
the customer's language and pace.

OBJECTIVE
Speak to the owner or website decision-maker for [business_name]. Determine
whether they want AgentFront's fixed-scope website package. If interested,
collect the minimum website requirements, state the configured fixed price,
read back the agreement and obtain explicit confirmation. A successful call
ends only when the decision-maker explicitly agrees to both scope and price.

CONTEXT
Business ID: [business_id]
Business: [business_name]
Category: [category]
Location: [location]
Package: [package_name]
Target price: [target_price] [currency]
Absolute minimum: [floor_price] [currency]

CONVERSATION STYLE
- Lead with the business-specific gap, not a generic speech.
- Be respectful but decisive. Avoid repeated apologies, filler and long monologues.
- Translate technical features into business outcomes: an official place to show
  menus/services, click-to-call or WhatsApp, Maps directions, mobile credibility
  and fewer repetitive customer questions. Never promise sales or rankings.
- Ask one focused question, listen fully, then respond to what was actually said.
- Keep most turns below two sentences unless the owner asks for detail.

GUARDRAILS
- At the opening, say that you are an AI sales assistant calling for AgentFront
  and state the reason for the call.
- First verify whether this is the owner or website decision-maker.
- If it is a receptionist, ask for the owner or a callback time. Do not
  negotiate with somebody who lacks authority.
- Treat a first casual "not interested" or price objection as an objection: ask
  one short diagnostic question, then explain one relevant benefit using the
  supplied business context and ask whether the fixed-scope package at [target_price] [currency] is useful.
- Make at most two objection responses. After a repeated clear refusal, wrong
  number or any do-not-call request, acknowledge once, store the correct outcome
  and end immediately without pressure.
- Never guarantee a website, ad campaign, ranking, revenue or customer increase.
- Never invent features, discounts, deadlines or payment status.
- Never go below [floor_price]. Never substitute a remembered price from an earlier client.
- Do not mark a deal won until contact details, requirements, price and the final
  spoken recap have been explicitly confirmed.
- Ask one short question at a time. Do not collect card or bank details.

WORKFLOW
1. Introduce yourself and verify the decision-maker.
2. Ask whether the business has a useful website and identify the main need.
3. Explain the fixed website package in no more than two sentences and quote exactly [target_price] [currency].
4. Collect owner name, preferred contact, the public business phone that may be
   published on the website, business description, main menu or services and
   prices, preferred style and colours, required sections,
   WhatsApp/call/map needs, and any special offer.
5. State exactly [target_price] [currency]; never use a hard-coded or remembered price.
6. Read back the exact scope, price and next step; ask for explicit confirmation.
7. If confirmed, explain that AgentFront will prepare the website and later send
   the deployment and payment links. Otherwise capture callback/lost reason.

DONE CONDITIONS
- DEAL_WON only after explicit scope and price confirmation.
- CALLBACK only with a concrete date/time when possible.
- DEAL_LOST for a clear refusal.
- DO_NOT_CALL immediately for any opt-out.
```

## 2. Variables

Create these input variables:

| Variable | Safe default value (overridden per approved call) |
| --- | --- |
| `business_id` | `business-placeholder` |
| `business_name` | `Selected business` |
| `category` | `local business` |
| `location` | `Selected location` |
| `package_name` | `Website package` |
| `target_price` | `0` |
| `floor_price` | `0` |
| `currency` | `INR` |

Create these output variables. Use Enum where the values are listed, String for
the remainder.

Do not continue using an older committed version after changing these variables. Commit the draft, copy its new version number into `SARVAM_SALES_APP_VERSION`, restart AgentFront, and run a browser/chat test proving that the spoken price and `agreed_price` both equal the injected `target_price`.

- `conversation_state`: `OWNER_CONNECTED`, `RECEPTIONIST_CONNECTED`,
  `OWNER_UNAVAILABLE`, `CALLBACK_REQUESTED`, `INTERESTED`, `NOT_INTERESTED`,
  `PRICE_OBJECTION`, `REQUIREMENTS_COLLECTION`, `NEGOTIATION`, `DEAL_WON`,
  `DEAL_LOST`, `CALL_FAILED`
- `deal_status`: `OPEN`, `CALLBACK`, `WON`, `LOST`
- `do_not_call`: `YES`, `NO`
- `owner_name`
- `client_email`
- `public_business_phone`
- `preferred_language`
- `agreed_price`
- `callback_at`
- `requirements_summary`
- `website_style`
- `primary_color`
- `services_prices`
- `next_action`

Sarvam requires these outcome fields to be extracted after the conversation.
The current dashboard does not expose the internal boolean fields. On
**Variables → Output variables**, use the three-dot menu on each row and replace
`Collected in call` with a real **Extraction prompt**, then save the variable.
That dashboard operation configures the equivalent API fields:

```text
is_agent_updatable = false
update_post_interaction = true
```

Use the following as the extraction prompt (replace `<variable_name>` and the
allowed values for each variable):

```text
Read the complete call transcript and return only the final value for
<variable_name>. Do not infer an agreement that the customer did not explicitly
state. If the value was not established, return an empty string. For enum
variables, return exactly one allowed enum value and no explanation.
```

For `deal_status`, explicitly add: `Return WON only when the decision-maker
explicitly confirms both [target_price] [currency] and the summarized website scope.`
For `do_not_call`, add: `Return YES only when the person explicitly opts out or
asks not to be contacted again; otherwise return NO.` With this configuration,
Sarvam Instant Outbound returns the committed extracted values in
`final_agent_variables`. AgentFront also accepts `output_agent_variables` for
compatibility, with that post-interaction value taking precedence when both are
present.

For `client_email`, add: `Return only the email address that the decision-maker explicitly confirms for receiving the website and secure payment link. Return an empty string if it was not confirmed.` A won call without a valid confirmed email remains incomplete and cannot start delivery.

For `public_business_phone`, add: `Return only the phone number that the owner
explicitly approved for publication on the website. Do not copy or infer the
number that was dialed.` AgentFront normalizes this result and requires it to
match the separate `DEMO_PUBLIC_BUSINESS_PHONE` allowlist. A missing or
mismatched value cannot produce a won specification or trigger OpenAI.

AgentFront must validate these variables and the transcript before creating a
`client_spec.json`. A Sarvam `WON` value alone is not payment confirmation.

## 3. Tests before PSTN

Create Sarvam test cases for: interested owner, receptionist, unavailable owner,
callback, Tamil-to-English switch, Hindi, price below floor, not interested,
do-not-call, wrong number, silence and noisy audio. Do not connect the phone
number until these pass.

## 4. Connect Vobiz and configure AgentFront

Follow Sarvam's Vobiz connection guide. Commit an agent version, then copy the
organization, workspace, app version, connection and agent-number identifiers
into the server-only environment variables shown in `.env.example`.

Set `TELEPHONY_PROVIDER=sarvam`. Set `DEMO_BUSINESS_PHONE` to the consented,
private call target and set `DEMO_PUBLIC_BUSINESS_PHONE` separately to the line
approved for the generated site. The values may match only when the owner
explicitly approves publishing that same number. Never prefix any Sarvam/Vobiz secret with
`VITE_`, and never paste credentials into the browser application.

For a manual or persistent deployment, generate a separate high-entropy
`SARVAM_WEBHOOK_TOKEN` and make `SARVAM_OUTBOUND_WEBHOOK_URL` end with:

```text
/api/webhooks/sarvam/outbound?token=<SARVAM_WEBHOOK_TOKEN>
```

Sarvam does not currently document a signature for this callback. AgentFront
therefore verifies the opaque URL token and correlates `attempt_id`, business ID
and sales-call ID against PostgreSQL before accepting a result.

The adapter calls Sarvam Instant Outbound using `X-API-Key`. Its default mode
replaces listing phones with `DEMO_BUSINESS_PHONE` and accepts only
`business-spiceroute`. With the reviewed-destination flag enabled, it instead
uses the exact persisted Place phone and supplies `business_id`, `business_name`,
`category`, `location`, package and price as per-call `agent_variables`. Delivery
never silently falls back to a private demo dial target:
the website phone comes only from the validated `public_business_phone` output.

## 5. Run the local reviewed-call flow

The callback URL must stay public for the whole call. A stale TryCloudflare URL
is rejected before AgentFront dials, because losing the callback would also lose
the authoritative transcript and requirements.

Install `cloudflared`, keep PostgreSQL running, then use the single launcher:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:sarvam
```

`npm run dev:sarvam` starts a restricted local callback relay, creates a new
process-only webhook token and TryCloudflare URL, injects both into the API and
worker processes for that run, and then starts the web app. It overrides any
`SARVAM_WEBHOOK_TOKEN` and callback URL stored in `.env`, and does not print the
token. If the tunnel exits, AgentFront is stopped so another call cannot start
without a callback.

Open `http://localhost:3000`, then:

1. Open **Discover**, run a real provider search, and select a qualified business with a phone number (or select SpiceRoute in demo mode).
2. Select **View intelligence**, verify the displayed name and phone, then use **Approve & call with Sarvam**.
3. Confirm Settings reports Sarvam and PostgreSQL as connected. OpenAI and
   Vercel are not required for the call-only demo.
4. During `10:00–19:00 Asia/Kolkata`, select **Approve & call with Sarvam** and
   accept the browser confirmation.
5. Answer the configured `DEMO_BUSINESS_PHONE` and complete the call.
6. Watch **Sales operations** and **Activity & logs** for the real call state and
   callback. If `DEMO_PUBLIC_BUSINESS_PHONE` is unset, the workflow stops safely
   after the call instead of starting Claude, QA or Vercel.

Do not run `npm run dev` and `npm run dev:sarvam` simultaneously. The latter is
the complete local real-call launcher.

If Settings says the public callback is degraded, stop the process, ensure
`cloudflared` is installed (or set `CLOUDFLARED_BIN` to its absolute path), and
start `npm run dev:sarvam` again. Do not place the call until the health row is
green.

The local launcher does not require a token in `.env`; remove any value that was
previously exposed instead of reusing it. For a manual or persistent deployment,
generate a different high-entropy token in the deployment secret manager and
never paste it into screenshots, browser configuration, logs, or Git.
