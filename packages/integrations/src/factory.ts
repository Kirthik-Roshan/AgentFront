import type { Business, ProviderSet } from "@agentfront/types";
import { DemoConversationProvider, ElevenLabsConversationProvider } from "./conversation";
import { DemoCRMProvider, FreshworksCRMProvider } from "./crm";
import { DemoDeploymentProvider, VercelCLIProvider } from "./deployment";
import { CodexCLIProvider, DemoDeveloperProvider } from "./developer";
import { DemoPlacesProvider, GooglePlacesProvider } from "./places";

export interface IntegrationEnvironment {
  DEMO_MODE?: string;
  GOOGLE_PLACES_API_KEY?: string;
  FRESHWORKS_DOMAIN?: string;
  FRESHWORKS_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  CODEX_ENABLED?: string;
  DEPLOY_PROVIDER?: string;
  DEPLOY_TOKEN?: string;
}

const configured = (...values: Array<string | undefined>): boolean =>
  values.every((value) => typeof value === "string" && value.trim().length > 0);
const normalizedSetting = (value: string | undefined): string => value?.trim().toLowerCase() ?? "";

export function createProviderSet(
  environment: IntegrationEnvironment,
  demoBusinesses: readonly Business[],
): ProviderSet {
  // Provider selection is capability-by-capability. Missing credentials select the
  // corresponding demo adapter; DEMO_MODE=true is the sole global force override.
  const forceDemo = normalizedSetting(environment.DEMO_MODE) === "true";
  const places =
    !forceDemo && configured(environment.GOOGLE_PLACES_API_KEY)
      ? new GooglePlacesProvider(environment.GOOGLE_PLACES_API_KEY!)
      : new DemoPlacesProvider(demoBusinesses);
  const crm =
    !forceDemo && configured(environment.FRESHWORKS_DOMAIN, environment.FRESHWORKS_API_KEY)
      ? new FreshworksCRMProvider({
          domain: environment.FRESHWORKS_DOMAIN!,
          apiKey: environment.FRESHWORKS_API_KEY!,
        })
      : new DemoCRMProvider();
  const conversation =
    !forceDemo && configured(environment.ELEVENLABS_API_KEY, environment.ELEVENLABS_AGENT_ID)
      ? new ElevenLabsConversationProvider(environment.ELEVENLABS_API_KEY!, environment.ELEVENLABS_AGENT_ID!)
      : new DemoConversationProvider();
  const developer =
    !forceDemo && normalizedSetting(environment.CODEX_ENABLED) === "true"
      ? new CodexCLIProvider()
      : new DemoDeveloperProvider();
  const deployment =
    !forceDemo && normalizedSetting(environment.DEPLOY_PROVIDER) === "vercel" && configured(environment.DEPLOY_TOKEN)
      ? new VercelCLIProvider(environment.DEPLOY_TOKEN!)
      : new DemoDeploymentProvider();
  return { places, crm, conversation, developer, deployment };
}
