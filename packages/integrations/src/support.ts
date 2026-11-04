import type { IntegrationHealth, SupportProvider, SupportTicketInput, SupportTicketResult } from "@agentfront/types";
import { requestJson } from "./http";

export interface FreshdeskSupportConfig {
  /** Freshdesk helpdesk hostname, not the Freshsales CRM hostname. */
  domain: string;
  apiKey: string;
  /** Requester for AgentFront's internal operational incidents. */
  requesterEmail: string;
}

function freshdeskHost(domain: string): string {
  const value = domain.trim();
  const url = new URL(value.startsWith("https://") ? value : `https://${value}`);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Freshdesk domain must be a hostname without a path, port, or credentials.");
  }
  return url.hostname;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required for a Freshdesk ticket.`);
  return trimmed;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/**
 * Freshdesk expects HTML in `description`. Keep the operator-provided content
 * escaped and include stable AgentFront IDs for manual reconciliation.
 */
export function mapIncidentToFreshdesk(input: SupportTicketInput, requesterEmail: string) {
  const lines = [
    `Category: ${input.category}`,
    `Business ID: ${required(input.businessId, "Business ID")}`,
    `Workflow ID: ${required(input.workflowId, "Workflow ID")}`,
    `Correlation ID: ${required(input.correlationId, "Correlation ID")}`,
    `Retry count: ${input.retryCount ?? 0}`,
    "",
    required(input.description, "Description"),
  ];
  return {
    email: requesterEmail,
    subject: required(input.subject, "Subject"),
    description: `<pre>${escapeHtml(lines.join("\n"))}</pre>`,
    priority: input.priority,
    status: 2, // Freshdesk Open
  };
}

export class FreshdeskSupportProvider implements SupportProvider {
  readonly name = "Freshdesk";
  readonly mode = "REAL" as const;
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #requesterEmail: string;
  readonly #created = new Map<string, SupportTicketResult>();

  constructor(config: FreshdeskSupportConfig) {
    const apiKey = required(config.apiKey, "Freshdesk API key");
    const requesterEmail = required(config.requesterEmail, "Freshdesk requester email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      throw new Error("Freshdesk requester email is invalid.");
    }
    this.#baseUrl = `https://${freshdeskHost(config.domain)}`;
    this.#requesterEmail = requesterEmail;
    this.#headers = {
      Authorization: `Basic ${Buffer.from(`${apiKey}:X`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  async createTicket(input: SupportTicketInput, idempotencyKey: string): Promise<SupportTicketResult> {
    const key = required(idempotencyKey, "Idempotency key");
    const replay = this.#created.get(key);
    if (replay) return replay;
    const response = await requestJson<{ id?: unknown }>(this.name, `${this.#baseUrl}/api/v2/tickets`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify(mapIncidentToFreshdesk(input, this.#requesterEmail)),
    });
    if ((typeof response.id !== "number" && typeof response.id !== "string") || !/^\d+$/.test(String(response.id))) {
      throw new Error("Freshdesk ticket response omitted a valid id.");
    }
    const result: SupportTicketResult = {
      status: "CREATED",
      id: String(response.id),
      url: `${this.#baseUrl}/a/tickets/${response.id}`,
    };
    this.#created.set(key, result);
    return result;
  }

  async health(): Promise<IntegrationHealth> {
    try {
      await requestJson<unknown>(this.name, `${this.#baseUrl}/api/v2/tickets?per_page=1`, {
        headers: this.#headers,
      });
      return {
        integration: "support",
        provider: this.name,
        mode: this.mode,
        status: "CONNECTED",
        message: "Freshdesk ticket API is readable.",
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        integration: "support",
        provider: this.name,
        mode: this.mode,
        status: "DEGRADED",
        message: "Freshdesk credentials are configured, but the ticket API check failed.",
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

/** Explicit no-write fallback: never impersonates a created support ticket. */
export class UnconfiguredSupportProvider implements SupportProvider {
  readonly name = "Freshdesk (not configured)";
  readonly mode = "DEMO" as const;

  async createTicket(): Promise<SupportTicketResult> {
    return { status: "NOT_CONFIGURED", id: null, url: null };
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "support",
      provider: this.name,
      mode: this.mode,
      status: "NOT_CONFIGURED",
      message: "Freshdesk ticket creation is disabled; no external ticket will be created.",
      checkedAt: new Date().toISOString(),
    };
  }
}
