-- Persist external CRM identities on the sales aggregate so outbox retries
-- can update records created by an earlier worker process.
ALTER TABLE "Business" ADD COLUMN "freshworksAccountId" TEXT;
ALTER TABLE "Business" ADD COLUMN "freshworksDealId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "freshworksContactId" TEXT;

CREATE UNIQUE INDEX "Business_freshworksAccountId_key" ON "Business"("freshworksAccountId");
CREATE UNIQUE INDEX "Business_freshworksDealId_key" ON "Business"("freshworksDealId");
CREATE UNIQUE INDEX "Contact_freshworksContactId_key" ON "Contact"("freshworksContactId");
