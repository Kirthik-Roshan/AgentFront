CREATE TYPE "DodoTestCheckoutStatus" AS ENUM ('RESERVED', 'READY', 'PAID', 'EXPIRED');

CREATE TABLE "DodoTestCheckout" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "customerName" TEXT,
  "productId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "DodoTestCheckoutStatus" NOT NULL DEFAULT 'RESERVED',
  "reservationToken" TEXT NOT NULL,
  "reservedUntil" TIMESTAMP(3) NOT NULL,
  "checkoutSessionId" TEXT,
  "checkoutUrl" TEXT,
  "checkoutExpiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "crmSyncedAt" TIMESTAMP(3),
  "crmLastError" TEXT,
  "crmLeaseToken" TEXT,
  "crmLeaseUntil" TIMESTAMP(3),
  "crmAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DodoTestCheckout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DodoTestPaymentClaim" (
  "id" TEXT NOT NULL,
  "checkoutId" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DodoTestPaymentClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DodoTestCheckout_idempotencyKey_key" ON "DodoTestCheckout"("idempotencyKey");
CREATE UNIQUE INDEX "DodoTestCheckout_checkoutSessionId_key" ON "DodoTestCheckout"("checkoutSessionId");
CREATE UNIQUE INDEX "DodoTestCheckout_one_active_project_key" ON "DodoTestCheckout"("projectId")
  WHERE "status" IN ('RESERVED', 'READY');
CREATE UNIQUE INDEX "DodoTestCheckout_one_paid_project_key" ON "DodoTestCheckout"("projectId")
  WHERE "status" = 'PAID';
CREATE INDEX "DodoTestCheckout_projectId_status_createdAt_idx" ON "DodoTestCheckout"("projectId", "status", "createdAt");
CREATE INDEX "DodoTestCheckout_status_reservedUntil_idx" ON "DodoTestCheckout"("status", "reservedUntil");
CREATE UNIQUE INDEX "DodoTestPaymentClaim_checkoutId_key" ON "DodoTestPaymentClaim"("checkoutId");
CREATE UNIQUE INDEX "DodoTestPaymentClaim_webhookId_key" ON "DodoTestPaymentClaim"("webhookId");
CREATE UNIQUE INDEX "DodoTestPaymentClaim_paymentId_key" ON "DodoTestPaymentClaim"("paymentId");

ALTER TABLE "DodoTestCheckout" ADD CONSTRAINT "DodoTestCheckout_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DodoTestPaymentClaim" ADD CONSTRAINT "DodoTestPaymentClaim_checkoutId_fkey"
  FOREIGN KEY ("checkoutId") REFERENCES "DodoTestCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
