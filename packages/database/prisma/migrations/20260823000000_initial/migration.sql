-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'STOPPED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('restaurant', 'salon', 'garments', 'mechanic');

-- CreateEnum
CREATE TYPE "DigitalPresenceStatus" AS ENUM ('NONE', 'WEAK', 'ADEQUATE', 'STRONG');

-- CreateEnum
CREATE TYPE "BusinessSource" AS ENUM ('GOOGLE_PLACES', 'DEMO');

-- CreateEnum
CREATE TYPE "PipelineState" AS ENUM ('DISCOVERED', 'QUALIFIED', 'CRM_CREATED', 'OUTREACH_READY', 'CONVERSATION_ACTIVE', 'REQUIREMENTS_COLLECTED', 'NEGOTIATING', 'DEAL_WON', 'SPEC_GENERATED', 'BUILD_QUEUED', 'BUILDING', 'QA', 'DEPLOYING', 'DEPLOYED', 'REJECTED', 'NOT_INTERESTED', 'FOLLOW_UP', 'DEAL_LOST', 'BUILD_FAILED', 'DEPLOY_FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'NEGOTIATING', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('SPEC_PENDING', 'SPEC_READY', 'QUEUED', 'BUILDING', 'QA', 'DEPLOYING', 'DEPLOYED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'DEPLOYING', 'DEPLOYED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProviderMode" AS ENUM ('REAL', 'DEMO');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "RevenueType" AS ENUM ('BOOKED', 'COLLECTED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "businessTypes" JSONB NOT NULL,
    "locations" JSONB NOT NULL,
    "qualificationPolicy" JSONB NOT NULL,
    "minimumOpportunityScore" INTEGER NOT NULL,
    "pricingPolicy" JSONB NOT NULL,
    "maximumCallsPerDay" INTEGER NOT NULL,
    "callingWindow" JSONB NOT NULL,
    "automaticProcessing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "externalPlaceId" TEXT,
    "name" TEXT NOT NULL,
    "category" "BusinessType" NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "phone" TEXT,
    "rating" DECIMAL(2,1) NOT NULL,
    "reviewCount" INTEGER NOT NULL,
    "website" TEXT,
    "googleMapsUrl" TEXT,
    "socialLinks" JSONB NOT NULL,
    "digitalPresenceStatus" "DigitalPresenceStatus" NOT NULL,
    "onlineOrdering" BOOLEAN,
    "reservationSystem" BOOLEAN,
    "source" "BusinessSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "qualificationReason" TEXT NOT NULL,
    "status" "PipelineState" NOT NULL DEFAULT 'DISCOVERED',
    "freshworksAccountId" TEXT,
    "freshworksContactId" TEXT,
    "freshworksDealId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMode" "ProviderMode" NOT NULL,
    "providerConversationId" TEXT NOT NULL,
    "clientToken" TEXT,
    "providerUrl" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'PENDING',
    "transcript" JSONB NOT NULL,
    "summary" TEXT,
    "sentiment" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirements" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "pages" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "branding" JSONB NOT NULL,
    "contentRequirements" JSONB NOT NULL,
    "budget" JSONB NOT NULL,
    "notes" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "Requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "quotedAmount" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "finalAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "acceptedAt" TIMESTAMP(3),
    "lostReason" TEXT,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "templateType" "BusinessType" NOT NULL,
    "specification" JSONB,
    "status" "ProjectStatus" NOT NULL DEFAULT 'SPEC_PENDING',
    "buildPath" TEXT,
    "buildLog" JSONB NOT NULL,
    "qaStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "qaResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMode" "ProviderMode" NOT NULL,
    "url" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "deployedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineTransition" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "from" "PipelineState",
    "to" "PipelineState" NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "projectId" TEXT,
    "campaignId" TEXT,
    "agentType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'INFO',
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "type" "RevenueType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSequence" (
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Business_externalPlaceId_key" ON "Business"("externalPlaceId");

-- CreateIndex
CREATE INDEX "Business_city_category_idx" ON "Business"("city", "category");

-- CreateIndex
CREATE INDEX "Business_digitalPresenceStatus_idx" ON "Business"("digitalPresenceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_projectId_key" ON "Lead"("projectId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_campaignId_status_idx" ON "Lead"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_businessId_campaignId_key" ON "Lead"("businessId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_providerConversationId_key" ON "Conversation"("providerConversationId");

-- CreateIndex
CREATE INDEX "Conversation_leadId_status_idx" ON "Conversation"("leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Requirements_leadId_key" ON "Requirements"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_leadId_key" ON "Deal"("leadId");

-- CreateIndex
CREATE INDEX "Deal_status_idx" ON "Deal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectId_key" ON "Project"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_leadId_key" ON "Project"("leadId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_projectId_key" ON "Deployment"("projectId");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineTransition_idempotencyKey_key" ON "PipelineTransition"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PipelineTransition_leadId_createdAt_idx" ON "PipelineTransition"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineTransition_projectId_idx" ON "PipelineTransition"("projectId");

-- CreateIndex
CREATE INDEX "AgentEvent_leadId_createdAt_idx" ON "AgentEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_projectId_createdAt_idx" ON "AgentEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_campaignId_createdAt_idx" ON "AgentEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "RevenueEvent_createdAt_idx" ON "RevenueEvent"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirements" ADD CONSTRAINT "Requirements_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineTransition" ADD CONSTRAINT "PipelineTransition_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
