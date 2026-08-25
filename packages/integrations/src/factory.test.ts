import { describe, expect, it } from "vitest";
import { createProviderSet } from "./factory";

const configuredEnvironment = {
  GOOGLE_PLACES_API_KEY: "google-test-key",
  FRESHWORKS_DOMAIN: "example.freshsales.io",
  FRESHWORKS_API_KEY: "freshworks-test-key",
  ELEVENLABS_API_KEY: "elevenlabs-test-key",
  ELEVENLABS_AGENT_ID: "agent-test-id",
  DEPLOY_PROVIDER: "vercel",
  DEPLOY_TOKEN: "vercel-test-token",
  CODEX_ENABLED: "true",
};

describe("provider selection", () => {
  it("uses demo adapters automatically for unconfigured capabilities", () => {
    const providers = createProviderSet({}, []);

    expect(Object.values(providers).map((provider) => provider.mode)).toEqual([
      "DEMO",
      "DEMO",
      "DEMO",
      "DEMO",
      "DEMO",
    ]);
  });

  it("selects each capability independently", () => {
    const providers = createProviderSet({ GOOGLE_PLACES_API_KEY: "google-test-key" }, []);

    expect(providers.places.mode).toBe("REAL");
    expect(providers.crm.mode).toBe("DEMO");
    expect(providers.conversation.mode).toBe("DEMO");
    expect(providers.developer.mode).toBe("DEMO");
    expect(providers.deployment.mode).toBe("DEMO");
  });

  it("activates configured real adapters without requiring DEMO_MODE=false", () => {
    const providers = createProviderSet(configuredEnvironment, []);

    expect(providers.places.mode).toBe("REAL");
    expect(providers.crm.mode).toBe("REAL");
    expect(providers.conversation.mode).toBe("REAL");
    expect(providers.developer.mode).toBe("REAL");
    expect(providers.deployment.mode).toBe("REAL");
  });

  it("treats only explicit DEMO_MODE=true as the global force override", () => {
    const forced = createProviderSet({ ...configuredEnvironment, DEMO_MODE: " TRUE " }, []);
    expect(Object.values(forced).every((provider) => provider.mode === "DEMO")).toBe(true);

    const automatic = createProviderSet({ ...configuredEnvironment, DEMO_MODE: "false" }, []);
    expect(Object.values(automatic).every((provider) => provider.mode === "REAL")).toBe(true);

    const automaticBlank = createProviderSet({ ...configuredEnvironment, DEMO_MODE: " " }, []);
    expect(Object.values(automaticBlank).every((provider) => provider.mode === "REAL")).toBe(true);
  });
});
