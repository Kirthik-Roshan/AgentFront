import type { Business, ProviderSet, SupportProvider } from "@agentfront/types";
import { DemoConversationProvider, ElevenLabsConversationProvider } from "./conversation";
import { DemoCRMProvider, FreshworksCRMProvider } from "./crm";
import { DemoDeploymentProvider, VercelCLIProvider } from "./deployment";
import { ClaudeDeveloperProvider, CodexCLIProvider, DemoDeveloperProvider, OpenAIDeveloperProvider } from "./developer";
import { DemoPlacesProvider, GooglePlacesProvider } from "./places";
import { FreshdeskSupportProvider, UnconfiguredSupportProvider } from "./support";

export interface IntegrationEnvironment {
  DEMO_MODE?: string;
  GOOGLE_PLACES_API_KEY?: string;
  FRESHWORKS_DOMAIN?: string;
  FRESHWORKS_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
  FRESHDESK_API_KEY?: string;
  FRESHDESK_REQUESTER_EMAIL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  CODEX_ENABLED?: string;
  DEVELOPER_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  DEPLOY_PROVIDER?: string;
  DEPLOY_TOKEN?: string;
  VERCEL_TEAM_ID?: string;
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
  const developerChoice = normalizedSetting(environment.DEVELOPER_PROVIDER);
  const developer = forceDemo
    ? new DemoDeveloperProvider()
    : developerChoice === "openai" && configured(environment.OPENAI_API_KEY)
      ? new OpenAIDeveloperProvider({ apiKey: environment.OPENAI_API_KEY!, model: environment.OPENAI_MODEL })
      : developerChoice === "claude" && configured(environment.ANTHROPIC_API_KEY)
        ? new ClaudeDeveloperProvider({ apiKey: environment.ANTHROPIC_API_KEY!, model: environment.CLAUDE_MODEL })
      : normalizedSetting(environment.CODEX_ENABLED) === "true"
        ? new CodexCLIProvider()
        : new DemoDeveloperProvider();
  const deployment =
    !forceDemo && normalizedSetting(environment.DEPLOY_PROVIDER) === "vercel" && configured(environment.DEPLOY_TOKEN)
      ? new VercelCLIProvider(environment.DEPLOY_TOKEN!, "vercel", environment.VERCEL_TEAM_ID)
      : new DemoDeploymentProvider();
  return { places, crm, conversation, developer, deployment };
}

/** Support is separate from Freshsales and is not yet triggered by workers. */
export function createSupportProvider(environment: IntegrationEnvironment): SupportProvider {
  if (normalizedSetting(environment.DEMO_MODE) === "true" ||
      !configured(environment.FRESHDESK_DOMAIN, environment.FRESHDESK_API_KEY, environment.FRESHDESK_REQUESTER_EMAIL)) {
    return new UnconfiguredSupportProvider();
  }
  return new FreshdeskSupportProvider({
    domain: environment.FRESHDESK_DOMAIN!,
    apiKey: environment.FRESHDESK_API_KEY!,
    requesterEmail: environment.FRESHDESK_REQUESTER_EMAIL!,
  });
}
