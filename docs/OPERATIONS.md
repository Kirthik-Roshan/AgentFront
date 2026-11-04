# Operations and recovery

## Emergency stop

Emergency stop rejects new workflow claims and lets in-flight provider calls finish or time out. It does not delete jobs or roll lifecycle state backward. Resume re-enables claims after the operator reviews failed and pending work.

## Retry procedure

1. Inspect the failed stage's structured events and provider health.
2. Correct configuration or transient provider state.
3. Retry that stage using the existing project and idempotency key.
4. Confirm the external provider record was reconciled rather than duplicated.
5. Resume orchestration from the recorded safe state.

## Failure ownership

| Failure | Recorded state | Recovery |
| --- | --- | --- |
| Places unavailable | discovery command failed | retry search; never relabel demo records as real |
| Freshworks unavailable | prior lead state retained | reconcile by AgentFront ID, then retry |
| Conversation unavailable | `OUTREACH_READY` retained | retry session or explicitly select demo for a demo campaign |
| REAL browser call ended without governed callback | `CONVERSATION_ACTIVE` retained | verify the bound ElevenLabs conversation, then retry the configured server tool/post-call adapter with the same idempotency key |
| Sarvam callback unavailable before dialing | call not started | restore the restricted public callback and wait for telephony health to report connected; do not bypass the preflight |
| Sarvam result fails token/correlation/requirements validation | sales state retained; no developer job | inspect the correlated call and rejected callback, correct provider output/configuration, and retry through the existing sales record |
| Build failed | `BUILD_FAILED` | inspect log, retry the ownership-bound workspace; use an OS/container sandbox in multi-tenant production |
| QA failed | `QA` with failed report | fix build; deployment remains blocked |
| Deployment failed | `DEPLOY_FAILED` | reconcile provider deployment ID, retry |
| CRM sync after deploy failed | deployed project + sync error | retry CRM note/stage without redeploying |

## Logging

Logs are structured and correlated by campaign, lead, and project. Redact authorization headers, API keys, customer-sensitive transcript material, and build-environment secrets before persistence or streaming.

REAL conversation completion is not inferred from browser disconnects. Monitor
the configured ElevenLabs server tool or verified post-call adapter, and alert
on calls that remain `CONVERSATION_ACTIVE`. For Sarvam, monitor the correlated
post-call route and never advance from a browser event or an unvalidated
provider payload. Rotate persistent `ELEVENLABS_TOOL_SECRET` and
`SARVAM_WEBHOOK_TOKEN` values independently from provider API keys and the
AgentFront founder credential; the local Sarvam launcher rotates its callback
token automatically on every run.
