import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  demoBusinesses,
  InMemoryAgentFrontStore,
  InMemorySalesRepository,
  PrismaAgentFrontStore,
  PrismaControlTowerRepository,
  PrismaDodoTestRepository,
  PrismaSalesRepository,
} from "@agentfront/database";
import { createProviderSet, createSupportProvider, createTelephonyProvider } from "@agentfront/integrations";
import { AgentEventBus, AgentFrontOrchestrator, SalesOrchestrator } from "@agentfront/orchestration";
import { ConversationGrantStore } from "./conversation-grants";

export const agentFrontRoot = fileURLToPath(new URL("../../../", import.meta.url));

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createRuntime(environment: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const outputRoot = environment.AGENTFRONT_OUTPUT_ROOT?.trim() || ".agentfront-runtime/generated-sites";
  const explicitDemo = environment.DEMO_MODE?.trim().toLowerCase() === "true";
  const environmentEmergencyStopped = environment.GLOBAL_EMERGENCY_STOP?.trim().toLowerCase() === "true";
  const store = databaseUrl
    ? new PrismaAgentFrontStore({ databaseUrl })
    : new InMemoryAgentFrontStore();
  const salesRepository = databaseUrl
    ? new PrismaSalesRepository({ databaseUrl })
    : new InMemorySalesRepository({ businesses: demoBusinesses });
  const controlTower = databaseUrl ? new PrismaControlTowerRepository({ databaseUrl,
    emergencyStop: environmentEmergencyStopped }) : null;
  const dodoTestRepository = databaseUrl
    ? new PrismaDodoTestRepository({ databaseUrl })
    : null;
  const providers = createProviderSet(environment, demoBusinesses);
  const support = createSupportProvider(environment);
  const telephony = createTelephonyProvider(environment);
  const events = new AgentEventBus();
  const salesOrchestrator = new SalesOrchestrator(salesRepository, telephony, events, {
    maximumAttempts: positiveInteger(environment.MAX_CALL_ATTEMPTS, 3),
    minimumMinutesBetweenAttempts: positiveInteger(environment.MIN_CALL_INTERVAL_MINUTES, 5),
  });
  const conversationGrants = new ConversationGrantStore();
  const orchestrator = new AgentFrontOrchestrator(store, providers, events, {
    templateRoot: resolve(agentFrontRoot, "templates"),
    // Runtime builds must never reuse the checked-in canonical example. Besides
    // corrupting the fixture, its bespoke multi-page config can differ from the
    // base template schema that provider customization expects.
    outputRoot: resolve(agentFrontRoot, outputRoot),
    shouldPause: () => controlTower?.emergencyStopped() ?? Promise.resolve(environmentEmergencyStopped),
  });
  const persistence = store instanceof PrismaAgentFrontStore
    ? {
        mode: "POSTGRESQL" as const,
        durable: true as const,
        health: () => store.health(),
      }
    : {
        mode: "IN_MEMORY" as const,
        durable: false as const,
        health: async () => ({
          mode: "IN_MEMORY" as const,
          durable: false as const,
          status: "DEMO" as const,
          message: explicitDemo
            ? "Explicit provider demo mode is active; DATABASE_URL is absent, so state is in memory."
            : "DATABASE_URL is absent; credential-free in-memory persistence is active.",
        }),
      };
  const close = async (): Promise<void> => {
    if (store instanceof PrismaAgentFrontStore) await store.disconnect();
    if (salesRepository instanceof PrismaSalesRepository) await salesRepository.disconnect();
    await controlTower?.disconnect();
    await dodoTestRepository?.disconnect();
  };
  return { store, salesRepository, controlTower, environmentEmergencyStopped, dodoTestRepository, providers, support, telephony, events, orchestrator, salesOrchestrator, conversationGrants, persistence, close };
}

export type ApiRuntime = ReturnType<typeof createRuntime>;
