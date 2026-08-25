import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { demoBusinesses, InMemoryAgentFrontStore, PrismaAgentFrontStore } from "@agentfront/database";
import { createProviderSet } from "@agentfront/integrations";
import { AgentEventBus, AgentFrontOrchestrator } from "@agentfront/orchestration";
import { ConversationGrantStore } from "./conversation-grants";

export const agentFrontRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function createRuntime(environment: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const outputRoot = environment.AGENTFRONT_OUTPUT_ROOT?.trim() || ".agentfront-runtime/generated-sites";
  const explicitDemo = environment.DEMO_MODE?.trim().toLowerCase() === "true";
  const store = databaseUrl && !explicitDemo
    ? new PrismaAgentFrontStore({ databaseUrl })
    : new InMemoryAgentFrontStore();
  const providers = createProviderSet(environment, demoBusinesses);
  const events = new AgentEventBus();
  const conversationGrants = new ConversationGrantStore();
  const orchestrator = new AgentFrontOrchestrator(store, providers, events, {
    templateRoot: resolve(agentFrontRoot, "templates"),
    // Runtime builds must never reuse the checked-in canonical example. Besides
    // corrupting the fixture, its bespoke multi-page config can differ from the
    // base template schema that provider customization expects.
    outputRoot: resolve(agentFrontRoot, outputRoot),
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
            ? "Explicit demo mode is using credential-free in-memory persistence."
            : "DATABASE_URL is absent; credential-free in-memory persistence is active.",
        }),
      };
  const close = async (): Promise<void> => {
    if (store instanceof PrismaAgentFrontStore) await store.disconnect();
  };
  return { store, providers, events, orchestrator, conversationGrants, persistence, close };
}

export type ApiRuntime = ReturnType<typeof createRuntime>;
