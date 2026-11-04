CREATE TABLE "SalesWorkerHeartbeat" (
  "workerId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesWorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "SalesWorkerHeartbeat_lastSeenAt_idx" ON "SalesWorkerHeartbeat"("lastSeenAt");
