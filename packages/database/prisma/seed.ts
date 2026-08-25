import { demoBusinesses, demoCampaign } from "../src/demo-data";
import { PrismaAgentFrontStore } from "../src/prisma-store";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed PostgreSQL.");
if (demoBusinesses.length !== 32) throw new Error(`Expected 32 demo businesses, received ${demoBusinesses.length}.`);

const store = new PrismaAgentFrontStore({ databaseUrl });

try {
  await store.upsertBusinesses(demoBusinesses);
  await store.upsertCampaigns([demoCampaign]);
  process.stdout.write(
    `${JSON.stringify({ event: "database.seeded", businesses: demoBusinesses.length, campaigns: 1 })}\n`,
  );
} finally {
  await store.disconnect();
}
