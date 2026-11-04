-- Sales orchestration is intentionally additive. The existing lead/delivery
-- pipeline remains intact while Business.id becomes the durable sales root.

CREATE TYPE "SalesState" AS ENUM (
  'DISCOVERED', 'QUALIFIED', 'CALL_PENDING', 'CALLING', 'CONTACTED',
  'RECEPTIONIST_CONTACTED', 'DECISION_MAKER_REQUIRED', 'OWNER_CONTACT_IDENTIFIED',
  'CALLBACK_REQUESTED', 'FOLLOW_UP_SCHEDULED', 'OWNER_CONTACTED',
  'DISCOVERY_CONVERSATION', 'REQUIREMENTS_COLLECTING', 'NEGOTIATING',
  'QUOTE_PRESENTED', 'FOLLOW_UP_REQUIRED', 'DEAL_WON', 'DEAL_LOST',
  'DO_NOT_CONTACT', 'SPEC_GENERATED', 'BUILD_PENDING', 'BUILDING', 'QA',
  'DEPLOYING', 'DEPLOYED'
);

CREATE TYPE "ContactRole" AS ENUM (
  'OWNER', 'CO_OWNER', 'MANAGER', 'DECISION_MAKER', 'RECEPTIONIST', 'EMPLOYEE', 'UNKNOWN'
);

CREATE TYPE "ContactSource" AS ENUM (
  'PUBLIC_LISTING', 'RECEPTIONIST_REFERRAL', 'INBOUND_CALL', 'OUTBOUND_CALL', 'CRM', 'FOUNDER', 'DEMO'
);

CREATE TYPE "SupportedSalesLanguage" AS ENUM (
  'ENGLISH', 'HINDI', 'TAMIL', 'KANNADA', 'TELUGU', 'MALAYALAM'
);

CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TYPE "SalesCallStatus" AS ENUM (
  'QUEUED', 'INITIATING', 'RINGING', 'IN_PROGRESS', 'COMPLETED',
  'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED'
);

CREATE TYPE "SalesCallOutcome" AS ENUM (
  'UNKNOWN', 'RECEPTIONIST_REACHED', 'DECISION_MAKER_REACHED',
  'OWNER_CONTACT_CAPTURED', 'CALLBACK_REQUESTED', 'FOLLOW_UP_REQUIRED',
  'DEAL_WON', 'DEAL_LOST', 'DO_NOT_CONTACT', 'NO_ANSWER', 'FAILED'
);

CREATE TYPE "FollowUpType" AS ENUM (
  'OUTBOUND_CALL', 'AWAIT_INBOUND_CALL', 'WHATSAPP', 'EMAIL', 'HUMAN_TASK'
);

CREATE TYPE "FollowUpStatus" AS ENUM (
  'SCHEDULED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED'
);

CREATE TYPE "SalesEventType" AS ENUM (
  'LEAD_QUEUED', 'SALES_STATE_CHANGED', 'CALL_SCHEDULED', 'CALL_STARTED',
  'CALL_CONNECTED', 'CALL_COMPLETED', 'CALL_FAILED', 'CONTACT_IDENTIFIED',
  'CONTACT_CREATED', 'CONTACT_UPDATED', 'RECEPTIONIST_IDENTIFIED',
  'OWNER_IDENTIFIED', 'OWNER_CONTACT_CREATED', 'CALLBACK_REQUESTED',
  'FOLLOWUP_SCHEDULED', 'FOLLOWUP_COMPLETED', 'REQUIREMENT_CAPTURED',
  'OBJECTION_RECORDED', 'QUOTE_CREATED', 'DEAL_WON', 'DEAL_LOST',
  'DO_NOT_CONTACT', 'CRM_SYNC_QUEUED', 'CRM_SYNCED', 'CRM_SYNC_FAILED',
  'SPEC_GENERATED', 'UNKNOWN_CALLER', 'JOB_RETRY_SCHEDULED', 'JOB_FAILED'
);

CREATE TYPE "SalesJobType" AS ENUM (
  'PROCESS_LEAD', 'START_OUTBOUND_CALL', 'PROCESS_FOLLOW_UP',
  'HANDLE_CALL_COMPLETION', 'SYNC_CRM', 'GENERATE_PROJECT_SPEC', 'TRIGGER_DEVELOPER'
);

CREATE TYPE "SalesJobStatus" AS ENUM (
  'QUEUED', 'PROCESSING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED',
  'DEAD_LETTER', 'CANCELLED'
);

CREATE TYPE "CRMOutboxOperation" AS ENUM (
  'UPSERT_BUSINESS', 'UPSERT_CONTACT', 'SYNC_QUALIFICATION', 'SYNC_CALL',
  'SYNC_FOLLOW_UP', 'SYNC_REQUIREMENTS', 'SYNC_QUOTE', 'SYNC_DEAL_STAGE',
  'SYNC_BUILD_STATUS', 'SYNC_DEPLOYMENT'
);

CREATE TYPE "CRMOutboxStatus" AS ENUM (
  'QUEUED', 'PROCESSING', 'RETRY_SCHEDULED', 'SYNCED', 'FAILED',
  'DEAD_LETTER', 'CANCELLED'
);

CREATE TYPE "SalesProjectSpecStatus" AS ENUM ('READY', 'DISPATCHED', 'FAILED');

ALTER TABLE "Business" ADD COLUMN "businessCode" TEXT;
ALTER TABLE "Business" ADD COLUMN "salesState" "SalesState" NOT NULL DEFAULT 'DISCOVERED';
ALTER TABLE "Business" ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "Business" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

WITH ranked_businesses AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS sequence
  FROM "Business"
)
UPDATE "Business" AS business
SET "businessCode" = 'AF-BIZ-' || LPAD(ranked_businesses.sequence::TEXT, 6, '0')
FROM ranked_businesses
WHERE business."id" = ranked_businesses."id" AND business."businessCode" IS NULL;

ALTER TABLE "Business" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE "Contact" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT,
  "phone" TEXT NOT NULL,
  "normalizedPhone" TEXT NOT NULL,
  "roles" "ContactRole"[] NOT NULL,
  "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
  "preferredLanguage" "SupportedSalesLanguage",
  "source" "ContactSource" NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Call" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "contactId" TEXT,
  "direction" "CallDirection" NOT NULL,
  "provider" TEXT NOT NULL,
  "providerCallId" TEXT,
  "providerMode" "ProviderMode" NOT NULL,
  "status" "SalesCallStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "outcome" "SalesCallOutcome",
  "language" "SupportedSalesLanguage",
  "transcript" TEXT,
  "summary" TEXT,
  "recordingUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesMemory" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "objections" JSONB NOT NULL,
  "requirements" JSONB NOT NULL,
  "quotedPrice" INTEGER,
  "agreedPrice" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "dealStage" "SalesState" NOT NULL DEFAULT 'DISCOVERED',
  "nextAction" TEXT,
  "nextActionAt" TIMESTAMP(3),
  "lastContactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUp" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "contactId" TEXT,
  "type" "FollowUpType" NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
  "reason" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "lastAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesEvent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "eventType" "SalesEventType" NOT NULL,
  "metadata" JSONB NOT NULL,
  "correlationId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesStateTransition" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "from" "SalesState" NOT NULL,
  "to" "SalesState" NOT NULL,
  "actor" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesStateTransition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesJob" (
  "id" TEXT NOT NULL,
  "businessId" TEXT,
  "type" "SalesJobType" NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "SalesJobStatus" NOT NULL DEFAULT 'QUEUED',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "lockedAt" TIMESTAMP(3),
  "lockExpiresAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CRMOutbox" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "operation" "CRMOutboxOperation" NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "CRMOutboxStatus" NOT NULL DEFAULT 'QUEUED',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "lockedAt" TIMESTAMP(3),
  "lockExpiresAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CRMOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesProjectSpec" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "contactId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "specification" JSONB NOT NULL,
  "status" "SalesProjectSpecStatus" NOT NULL DEFAULT 'READY',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesProjectSpec_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Business_businessCode_key" ON "Business"("businessCode");
CREATE INDEX "Business_salesState_updatedAt_idx" ON "Business"("salesState", "updatedAt");

CREATE UNIQUE INDEX "Contact_dedupeKey_key" ON "Contact"("dedupeKey");
CREATE INDEX "Contact_normalizedPhone_idx" ON "Contact"("normalizedPhone");
CREATE INDEX "Contact_businessId_isDecisionMaker_idx" ON "Contact"("businessId", "isDecisionMaker");

CREATE UNIQUE INDEX "Call_idempotencyKey_key" ON "Call"("idempotencyKey");
CREATE UNIQUE INDEX "Call_provider_providerCallId_key" ON "Call"("provider", "providerCallId");
CREATE INDEX "Call_businessId_createdAt_idx" ON "Call"("businessId", "createdAt");
CREATE INDEX "Call_contactId_createdAt_idx" ON "Call"("contactId", "createdAt");
CREATE INDEX "Call_status_createdAt_idx" ON "Call"("status", "createdAt");

CREATE UNIQUE INDEX "SalesMemory_businessId_key" ON "SalesMemory"("businessId");
CREATE INDEX "SalesMemory_dealStage_nextActionAt_idx" ON "SalesMemory"("dealStage", "nextActionAt");

CREATE UNIQUE INDEX "FollowUp_dedupeKey_key" ON "FollowUp"("dedupeKey");
CREATE INDEX "FollowUp_status_scheduledAt_idx" ON "FollowUp"("status", "scheduledAt");
CREATE INDEX "FollowUp_businessId_createdAt_idx" ON "FollowUp"("businessId", "createdAt");

CREATE UNIQUE INDEX "SalesEvent_idempotencyKey_key" ON "SalesEvent"("idempotencyKey");
CREATE INDEX "SalesEvent_businessId_timestamp_idx" ON "SalesEvent"("businessId", "timestamp");
CREATE INDEX "SalesEvent_eventType_timestamp_idx" ON "SalesEvent"("eventType", "timestamp");

CREATE UNIQUE INDEX "SalesStateTransition_idempotencyKey_key" ON "SalesStateTransition"("idempotencyKey");
CREATE INDEX "SalesStateTransition_businessId_createdAt_idx" ON "SalesStateTransition"("businessId", "createdAt");

CREATE UNIQUE INDEX "SalesJob_dedupeKey_key" ON "SalesJob"("dedupeKey");
CREATE INDEX "SalesJob_status_availableAt_idx" ON "SalesJob"("status", "availableAt");
CREATE INDEX "SalesJob_businessId_createdAt_idx" ON "SalesJob"("businessId", "createdAt");
CREATE INDEX "SalesJob_lockExpiresAt_idx" ON "SalesJob"("lockExpiresAt");

CREATE UNIQUE INDEX "CRMOutbox_idempotencyKey_key" ON "CRMOutbox"("idempotencyKey");
CREATE INDEX "CRMOutbox_status_availableAt_idx" ON "CRMOutbox"("status", "availableAt");
CREATE INDEX "CRMOutbox_businessId_createdAt_idx" ON "CRMOutbox"("businessId", "createdAt");
CREATE INDEX "CRMOutbox_lockExpiresAt_idx" ON "CRMOutbox"("lockExpiresAt");

CREATE UNIQUE INDEX "SalesProjectSpec_idempotencyKey_key" ON "SalesProjectSpec"("idempotencyKey");
CREATE UNIQUE INDEX "SalesProjectSpec_businessId_version_key" ON "SalesProjectSpec"("businessId", "version");
CREATE INDEX "SalesProjectSpec_businessId_createdAt_idx" ON "SalesProjectSpec"("businessId", "createdAt");
CREATE INDEX "SalesProjectSpec_status_updatedAt_idx" ON "SalesProjectSpec"("status", "updatedAt");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesMemory" ADD CONSTRAINT "SalesMemory_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesMemory" ADD CONSTRAINT "SalesMemory_lastContactId_fkey"
  FOREIGN KEY ("lastContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesEvent" ADD CONSTRAINT "SalesEvent_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesStateTransition" ADD CONSTRAINT "SalesStateTransition_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesJob" ADD CONSTRAINT "SalesJob_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CRMOutbox" ADD CONSTRAINT "CRMOutbox_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectSpec" ADD CONSTRAINT "SalesProjectSpec_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectSpec" ADD CONSTRAINT "SalesProjectSpec_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
