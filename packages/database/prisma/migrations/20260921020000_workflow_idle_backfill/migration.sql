-- Registration in the control tower is not evidence of an active agent.
-- This follow-up keeps the already-applied foundation migration immutable.
ALTER TABLE "Workflow" ALTER COLUMN "status" SET DEFAULT 'IDLE';

UPDATE "Workflow" AS w
SET "status" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "SalesJob" AS j
    WHERE j."workflowId" = w."id" AND j."status" IN ('QUEUED', 'PROCESSING', 'RETRY_SCHEDULED')
  ) THEN 'ACTIVE'
  ELSE 'IDLE'
END,
"currentTask" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "SalesJob" AS j
    WHERE j."workflowId" = w."id" AND j."status" IN ('QUEUED', 'PROCESSING', 'RETRY_SCHEDULED')
  ) THEN w."currentTask"
  ELSE NULL
END
WHERE w."status" = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "AgentRun" AS r WHERE r."workflowId" = w."id");
