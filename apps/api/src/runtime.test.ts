import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryAgentFrontStore, PrismaAgentFrontStore } from "@agentfront/database";
import { agentFrontRoot, createRuntime } from "./runtime";

describe("API persistence selection", () => {
  it("uses credential-free in-memory persistence when DATABASE_URL is absent", async () => {
    const runtime = createRuntime({ DEMO_MODE: "" });
    expect(runtime.store).toBeInstanceOf(InMemoryAgentFrontStore);
    expect(runtime.orchestrator.options.templateRoot).toBe(resolve(agentFrontRoot, "templates"));
    expect(runtime.orchestrator.options.outputRoot).toBe(resolve(agentFrontRoot, ".agentfront-runtime/generated-sites"));
    expect(runtime.orchestrator.options.outputRoot).not.toBe(resolve(agentFrontRoot, "generated-sites"));
    expect(await runtime.persistence.health()).toMatchObject({
      mode: "IN_MEMORY",
      durable: false,
      status: "DEMO",
    });
    await runtime.close();
  });

  it("allows an operator-owned runtime artifact root without touching the canonical example", async () => {
    const runtime = createRuntime({ DEMO_MODE: "true", AGENTFRONT_OUTPUT_ROOT: "var/agentfront-builds" });
    expect(runtime.orchestrator.options.outputRoot).toBe(resolve(agentFrontRoot, "var/agentfront-builds"));
    await runtime.close();
  });

  it("selects PostgreSQL only when configured and lets explicit demo mode override it", async () => {
    const databaseUrl = "postgresql://agentfront:agentfront@127.0.0.1:1/agentfront";
    const postgres = createRuntime({ DATABASE_URL: databaseUrl });
    expect(postgres.store).toBeInstanceOf(PrismaAgentFrontStore);
    expect(postgres.persistence).toMatchObject({ mode: "POSTGRESQL", durable: true });
    await postgres.close();

    const demo = createRuntime({ DATABASE_URL: databaseUrl, DEMO_MODE: "true" });
    expect(demo.store).toBeInstanceOf(InMemoryAgentFrontStore);
    expect(demo.persistence.mode).toBe("IN_MEMORY");
    await demo.close();
  });

  it("reports a configured but unreachable database as degraded without failing health", async () => {
    const runtime = createRuntime({
      DATABASE_URL: "postgresql://agentfront:agentfront@127.0.0.1:1/agentfront",
    });
    expect(await runtime.persistence.health()).toMatchObject({
      mode: "POSTGRESQL",
      durable: true,
      status: "DEGRADED",
    });
    await runtime.close();
  });
});
