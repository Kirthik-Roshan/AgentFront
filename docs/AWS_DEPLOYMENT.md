# AWS deployment readiness

**Readiness, not a deployed environment.** The additive Phase 1 migration
introduces workflow/event/agent-run records and extends the existing Postgres
job table for five-agent jobs. No AWS account, SQS consumer, EventBridge
schedule, ECS task definition, image registry or Secrets Manager integration
is installed by this change. In PostgreSQL mode, accepted API continuation
commands are committed to the job table and consumed by a separate worker.
The credential-free in-memory demo still uses process-local scheduling.
Provider side effects in the legacy orchestrator need crash reconciliation
before multiple production API/worker replicas are safe.

The repository is structured for AWS without making AWS mandatory for local
development. Do not deploy the static Vercel frontend and assume it also runs
the API, workers, Codex CLI, or scheduled callbacks.

## Recommended first production topology

| AgentFront responsibility | AWS service |
| --- | --- |
| React control plane | S3 + CloudFront, or the existing Vercel frontend |
| REST/SSE API and provider webhooks | ECS/Fargate behind an ALB or API Gateway |
| Five-agent worker handlers | ECS/Fargate service(s) with no public ingress |
| Canonical state and outbox | RDS PostgreSQL |
| Immediate jobs | SQS with a dead-letter queue |
| Scheduled callbacks | EventBridge Scheduler -> SQS |
| Provider credentials | Secrets Manager |
| Structured logs and alarms | CloudWatch Logs/Metrics |
| Generated-site artifacts | S3, then the configured deployment provider |

Lambda is suitable for short webhook handlers and lightweight jobs. Website
builds that invoke the OpenAI Responses API or need an isolated filesystem should run in an ECS task
with a narrow task role and a per-project workspace.

## Migration path

1. Apply the migrations, then run the current PostgreSQL repository and
   database-backed jobs on one API and one worker service. This is a
   transitional deployment, not the complete five-agent system.
2. Implement the five handlers and SQS transport around the existing durable
   job IDs and idempotency contracts. PostgreSQL stays the source of truth.
3. Replace local due-follow-up polling with EventBridge schedules that enqueue
   the same jobs.
4. Move secrets from environment files to Secrets Manager task injections.
5. Keep cursor-based PostgreSQL SSE polling initially; add shared fan-out only
   if measured traffic or multi-replica latency requires it.

## Required production configuration

- `DATABASE_URL`
- `AGENTFRONT_API_TOKEN` and `AGENTFRONT_SESSION_SECRET`
- `WEB_ORIGIN`
- `TELEPHONY_PROVIDER` plus the selected provider credentials
- `TELEPHONY_PROVIDER=sarvam`, the server-only `SARVAM_*` values and a reachable
  callback for the controlled Sales adapter
- `FRESHWORKS_DOMAIN` and `FRESHWORKS_API_KEY` when CRM sync is enabled
- `AWS_REGION` and `AWS_SQS_QUEUE_URL` after switching to the AWS queue adapter

Use IAM task roles instead of long-lived `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` in production. Restrict inbound provider webhook routes,
verify every provider signature, encrypt RDS and queues, and never expose any
server credential through a `VITE_*` variable.

## Operational alarms

Alert on dead-letter jobs, expired job leases, follow-ups overdue beyond the
calling window, repeated telephony/voice failures, CRM outbox age, webhook
signature failures, database saturation, and `DO_NOT_CONTACT` policy violations.
