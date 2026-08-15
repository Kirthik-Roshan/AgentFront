# Architecture

## Design goals

AgentFront is deliberately frontend-only. The architecture prioritises a reliable presentation, explicit workflow invariants, clear simulation boundaries and straightforward replacement of fixtures with reviewed integrations in a future system.

## Runtime flow

```text
Local fixtures
    ↓
DemoProvider state machine
    ↓
AppShell ── Sidebar / Top bar / Presenter panel
    ↓
Seven stage views
    ↓
GeneratedSite isolated client preview
```

`DemoProvider` is the source of truth for active and unlocked stages. Approval actions update both the relevant domain flag and the highest unlocked stage in one transition. UI views call those actions rather than mutating progress themselves.

## State invariants

- Outreach cannot be opened in the normal manual path before `outreachApproved`.
- Agreement cannot be reached before `requirementsApproved`.
- A deal cannot close before `offerApproved`.
- The release QA state cannot complete before the build has started.
- Delivery is locked until build completion.
- Deployment requires an explicit presenter click.
- Reset removes persisted demo state and restores discovery.
- Presenter shortcuts intentionally force-unlock a stage for presentation recovery; they do not perform external actions.

## Guided mode

Guided playback advances a deterministic local timeline. It reveals messages, records approvals, runs agent progress and reaches deployment in approximately 90 seconds. Pause freezes both the journey clock and build animation. “Skip animation” completes only the current animated section, preserving valid stage state.

## Project structure

```text
src/
  components/       App chrome, reusable conversation/UI, generated site
  data/             Businesses, messages, build steps, generated site fixture
  hooks/            Central demo state machine and local persistence
  types/            Shared domain types
  views/            Seven operational stage screens
  styles/           Dashboard and generated-client visual systems
public/demo-assets/ Local industrial gallery imagery
docs/screenshots/   Repository screenshots
```

## Data and persistence

All data is imported TypeScript. `localStorage` preserves progress under `agentfront-demo`; no personal data is collected. Reloading resumes manual mode for presenter safety. No runtime network request is required.

## Accessibility and resilience

Native buttons, links, labels, forms and headings are used throughout. Focus states have visible teal outlines. Layouts collapse at 1180, 900 and 620-pixel breakpoints. Reduced-motion preferences disable nonessential transitions. Guided-demo controls always expose manual pause, continue and skip paths.

## Production boundary

This code should not be extended into real outreach or data collection simply by adding API keys. A production system needs a separate secure service boundary, identity, consent records, provider agreements, validation, audit logs, moderation, rate limits and human approval tooling.
