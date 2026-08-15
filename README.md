# AgentFront

AgentFront is a polished interactive concept prototype for HackFusion 2026 Round 1. It demonstrates how a consent-first, AI-operated digital agency could help an offline business move from discovery to a verified website—without performing any real automation.

> **Interactive concept demo:** all business data, conversations, agent work, deployment, invoices and payments are simulated.

## Problem

Many capable offline businesses have a physical location and active customer relationships but no useful website. Creating one still requires discovery, qualification, requirement gathering, commercial negotiation, production and ongoing maintenance across disconnected workflows.

## Proposed final solution

The proposed AgentFront system would coordinate those steps through specialised agents under explicit owner consent and human approval gates. Discovery would use lawful data sources, outreach would be approved and transparent, requirements would be owner-verified, pricing would remain within supervised limits, and publishing would require final approval.

## What this prototype demonstrates

This frontend simulates a complete journey for **Kumar Engineering Works**, an explicitly fictional demo business:

1. Discover local businesses on a schematic map.
2. Qualify a lead with a transparent rule-based score.
3. Approve and replay consent-first outreach.
4. Convert a bilingual requirements conversation into a live brief.
5. Negotiate a price with a mandatory supervisor checkpoint.
6. Simulate a six-agent build and QA workflow.
7. Preview, deliver, invoice and maintain a generated client website.

## Simulated features

The prototype does **not** scrape listings, send messages, call AI or speech APIs, process payments, upload files, deploy websites or create contracts. Demo contacts are fictional. All fixtures live in the repository, interactions use local state, and progress is stored only in `localStorage`.

## Highlights

- Manual mode and an approximately 90-second guided-demo mode
- Pause, continue, skip-animation and full-reset controls
- Persistent presenter panel with stage shortcuts and narration prompts
- Ten fictional businesses across five requested categories
- Local schematic Chennai map with clickable markers
- Permission-first outreach and Tamil voice-note transcription simulation
- Live requirement extraction with verification states
- Human-controlled final pricing and deployment gates
- Specialist-agent workflow with visible logs and QA status
- Responsive desktop/mobile client website preview
- Interactive language toggle, file upload and quote-form simulations
- Traceable before/after maintenance change flow
- Keyboard focus styles, semantic forms and reduced-motion support

## Technology

- React
- Vite
- TypeScript
- Plain CSS
- Lucide React icons
- Local TypeScript fixtures and `localStorage`

No backend, database, authentication, API key or environment variable is required.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Production checks:

```bash
npm run typecheck
npm run lint
npm run build
npm run preview
```

## Demo instructions

For a controlled walkthrough, use **Manual Mode** and follow the numbered sidebar. Each protected stage becomes available after its approval gate.

For the presentation path, open **Presenter panel → Start guided demo**. The default journey selects Kumar Engineering Works. Pause or skip the current animation at any time. See [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) for exact clicks, narration and a reliable backup path.

## Screenshots

![Business discovery dashboard](./docs/screenshots/discovery.png)

![Generated client website](./docs/screenshots/client-website.png)

## Architecture summary

A central React context implements the demo state machine and owns stage locks, approvals, conversation indices, build progress, guided playback and persisted progress. Views render state but cannot independently unlock invalid stages. Fixture data is kept in `src/data`, reusable UI in `src/components`, workflow pages in `src/views`, and visual systems in `src/styles`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the detailed state flow and project map.

## Responsible-use controls

- A disclosure banner remains visible throughout the operations dashboard.
- Every person, contact, listing, message and transaction is identified as fictional or simulated.
- Outreach requires human approval and the assistant identifies itself as AI.
- Requirements and final delivery require owner approval.
- Final pricing requires a human supervisor.
- File upload, WhatsApp, payment and deployment controls never transmit data.
- The qualification score is labelled rule-based, not predictive AI.

## Future automation roadmap

A real implementation would require consent management, approved data-provider contracts, secure messaging, human-in-the-loop AI orchestration, payment compliance, audit logs and monitored deployment infrastructure. See [FUTURE_SCOPE.md](./FUTURE_SCOPE.md) for the complete separation between simulated and future capabilities.

## Demo video

Demo video: **[Add HackFusion submission video link here]**

## HackFusion 2026 Round 1

This repository is prepared as a Round-1 frontend concept submission. It is intentionally a convincing static simulation, not a production automation service.
