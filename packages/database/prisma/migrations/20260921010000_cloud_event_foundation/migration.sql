-- Additive transition: the existing AgentEvent and SalesJob tables remain the
-- canonical ledgers. No client, deal, or payment row is dropped or recreated.
ALTER TYPE "SalesJobType" ADD VALUE IF NOT EXISTS 'WORKFLOW_TASK';

CREATE TABLE "Workflow" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "currentAgent" TEXT,
  "currentTask" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Workflow_businessId_key" ON "Workflow"("businessId");
CREATE UNIQUE INDEX "Workflow_correlationId_key" ON "Workflow"("correlationId");
CREATE INDEX "Workflow_status_updatedAt_idx" ON "Workflow"("status", "updatedAt");
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "agentType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "provider" TEXT,
  "externalId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentRun_jobId_retryCount_key" ON "AgentRun"("jobId", "retryCount");
CREATE INDEX "AgentRun_workflowId_startedAt_idx" ON "AgentRun"("workflowId", "startedAt");
CREATE INDEX "AgentRun_agentType_status_startedAt_idx" ON "AgentRun"("agentType", "status", "startedAt");
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SystemControl" (
  "id" TEXT NOT NULL,
  "emergencyStopped" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemControl_pkey" PRIMARY KEY ("id")
);
INSERT INTO "SystemControl" ("id", "emergencyStopped", "updatedAt")
VALUES ('global', false, CURRENT_TIMESTAMP);

ALTER TABLE "AgentEvent" ADD COLUMN "businessId" TEXT,
  ADD COLUMN "workflowId" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "sourceAgent" TEXT,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payload" JSONB;
CREATE INDEX "AgentEvent_businessId_createdAt_id_idx" ON "AgentEvent"("businessId", "createdAt", "id");
CREATE INDEX "AgentEvent_workflowId_createdAt_id_idx" ON "AgentEvent"("workflowId", "createdAt", "id");
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesJob" ADD COLUMN "workflowId" TEXT,
  ADD COLUMN "agentType" TEXT NOT NULL DEFAULT 'SALES';
CREATE INDEX "SalesJob_agentType_status_availableAt_idx" ON "SalesJob"("agentType", "status", "availableAt");
ALTER TABLE "SalesJob" ADD CONSTRAINT "SalesJob_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing businesses, projects and sales-only leads resolve to the same
-- business-scoped workflow. The business ID remains the durable correlation.
INSERT INTO "Workflow" ("id", "businessId", "correlationId", "status", "createdAt", "updatedAt")
SELECT 'workflow-' || "id", "id", "id", 'ACTIVE', "createdAt", COALESCE("updatedAt", "createdAt")
FROM "Business" ON CONFLICT ("businessId") DO NOTHING;

UPDATE "AgentEvent" e SET
  "businessId" = l."businessId",
  "workflowId" = w."id",
  "correlationId" = COALESCE(e."projectId", w."correlationId"),
  "sourceAgent" = CASE
    WHEN e."agentType" IN ('DISCOVERY', 'QUALIFICATION') THEN 'DISCOVER'
    WHEN e."agentType" IN ('CRM', 'SALES', 'NEGOTIATION') THEN 'SALES'
    WHEN e."agentType" IN ('SPECIFICATION', 'DEVELOPER', 'QA', 'DEPLOYMENT') THEN 'DEVELOPER'
    WHEN e."agentType" IN ('DELIVER', 'REVENUE') THEN 'DELIVERY'
    ELSE 'SALES' END,
  "payload" = e."metadata"
FROM "Lead" l JOIN "Workflow" w ON w."businessId" = l."businessId"
WHERE e."leadId" = l."id" AND e."workflowId" IS NULL;

-- SalesEvent remains readable for legacy consumers during the cutover, but
-- existing sales history is also present in the one dashboard event ledger.
INSERT INTO "AgentEvent" ("id", "businessId", "workflowId", "correlationId",
 "sourceAgent", "agentType", "eventType", "message", "metadata", "payload",
 "status", "retryCount", "createdAt")
SELECT 'sales-event-' || s."id", s."businessId", w."id",
 COALESCE(s."correlationId", w."correlationId"), 'SALES', 'SALES',
 'sales.' || lower(s."eventType"::text), s."eventType"::text || ' · ' || b."name",
 s."metadata", s."metadata",
 CASE WHEN s."eventType"::text IN ('CALL_FAILED', 'JOB_FAILED') THEN 'ERROR'::"EventStatus" ELSE 'INFO'::"EventStatus" END,
 0, s."timestamp"
FROM "SalesEvent" s JOIN "Workflow" w ON w."businessId" = s."businessId"
JOIN "Business" b ON b."id" = s."businessId"
ON CONFLICT ("id") DO NOTHING;

UPDATE "SalesJob" j SET "workflowId" = w."id"
FROM "Workflow" w WHERE j."businessId" = w."businessId" AND j."workflowId" IS NULL;
