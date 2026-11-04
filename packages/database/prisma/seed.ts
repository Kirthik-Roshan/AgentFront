import { demoBusinesses, demoCampaign } from "../src/demo-data";
import { PrismaAgentFrontStore } from "../src/prisma-store";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed PostgreSQL.");
if (demoBusinesses.length !== 1 || demoBusinesses[0]?.id !== "business-spiceroute") {
  throw new Error("The seed registry must contain only the SpiceRoute demo business.");
}

const store = new PrismaAgentFrontStore({ databaseUrl });

try {
  const removedDemoBusinesses = await store.pruneDemoBusinessesExcept("business-spiceroute");
  await store.upsertBusinesses(demoBusinesses);
  await store.upsertCampaigns([demoCampaign]);
  process.stdout.write(
    `${JSON.stringify({ event: "database.seeded", businesses: demoBusinesses.length, removedDemoBusinesses, campaigns: 1 })}\n`,
  );
} finally {
  await store.disconnect();
}
