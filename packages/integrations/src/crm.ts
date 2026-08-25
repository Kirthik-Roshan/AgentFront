import type {
  CRMAccountInput,
  CRMContactInput,
  CRMDealInput,
  CRMDealRecord,
  CRMDealSummary,
  CRMProvider,
  CRMRecord,
  IntegrationHealth,
} from "@agentfront/types";
import { requestJson } from "./http";

type JsonObject = Record<string, unknown>;

export function mapBusinessToFreshworksAccount(input: CRMAccountInput): JsonObject {
  return {
    sales_account: {
      name: input.business.name,
      address: input.business.address,
      city: input.business.city,
      phone: input.business.phone,
      website: input.business.website,
    },
  };
}

export function mapBusinessToFreshworksContact(input: CRMContactInput): JsonObject {
  const [firstName, ...remaining] = input.displayName.trim().split(/\s+/);
  return {
    contact: {
      first_name: firstName || input.business.name,
      last_name: remaining.join(" ") || "Owner",
      mobile_number: input.business.phone,
      sales_accounts: [{ id: Number(input.accountId), is_primary: true }],
    },
  };
}

export function mapDealToFreshworks(input: CRMDealInput, stageId?: number): JsonObject {
  return {
    deal: {
      name: `${input.projectId} · ${input.title}`,
      amount: input.amount,
      sales_account_id: Number(input.accountId),
      contacts_added_list: [Number(input.contactId)],
      ...(stageId ? { deal_stage_id: stageId } : {}),
    },
  };
}

interface FreshworksConfig {
  domain: string;
  apiKey: string;
  stageIds?: Record<string, number>;
}

type FreshworksDeal = {
  id?: string | number;
  name?: string;
  amount?: string | number;
  deal_stage_id?: string | number;
  deal_stage?: { id?: string | number; name?: string };
  sales_account?: { name?: string };
  contacts?: Array<{ display_name?: string; first_name?: string; last_name?: string }>;
  updated_at?: string;
};

const readId = (value: unknown, resource: string): string => {
  if (!value || typeof value !== "object") throw new Error(`Freshworks ${resource} response was malformed.`);
  const id = (value as { id?: string | number }).id;
  if (typeof id !== "string" && typeof id !== "number") throw new Error(`Freshworks ${resource} response omitted id.`);
  return String(id);
};

export class FreshworksCRMProvider implements CRMProvider {
  readonly name = "Freshworks CRM";
  readonly mode = "REAL" as const;
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #idempotentRecords = new Map<string, CRMRecord | CRMDealRecord>();
  readonly #dealStages = new Map<string, string>();
  readonly #stageIds = new Map<string, number>();

  constructor(config: FreshworksConfig) {
    if (!config.domain.trim() || !config.apiKey.trim()) throw new Error("Freshworks domain and API key are required.");
    // Accept a host as documented, while forgiving the common pasted
    // `/crm/sales` suffix without ever putting it into an API URL twice.
    const host = config.domain.replace(/^https?:\/\//, "").replace(/\/crm\/sales\/?$/i, "").replace(/\/$/, "");
    this.#baseUrl = `https://${host}/crm/sales/api`;
    this.#headers = {
      Authorization: `Token token=${config.apiKey}`,
      "Content-Type": "application/json",
    };
    for (const [name, id] of Object.entries(config.stageIds ?? {})) this.#stageIds.set(name.toLowerCase(), id);
  }

  async createAccount(input: CRMAccountInput, idempotencyKey: string): Promise<CRMRecord> {
    const replay = this.#idempotentRecords.get(idempotencyKey);
    if (replay) return replay;
    const response = await requestJson<{ sales_account: unknown }>(this.name, `${this.#baseUrl}/sales_accounts`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify(mapBusinessToFreshworksAccount(input)),
    });
    const id = readId(response.sales_account, "sales account");
    const record = { id, url: `${this.#baseUrl.replace(/\/api$/, "")}/sales_accounts/${id}`, created: true };
    this.#idempotentRecords.set(idempotencyKey, record);
    return record;
  }

  async createContact(input: CRMContactInput, idempotencyKey: string): Promise<CRMRecord> {
    const replay = this.#idempotentRecords.get(idempotencyKey);
    if (replay) return replay;
    const response = await requestJson<{ contact: unknown }>(this.name, `${this.#baseUrl}/contacts`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify(mapBusinessToFreshworksContact(input)),
    });
    const id = readId(response.contact, "contact");
    const record = { id, url: `${this.#baseUrl.replace(/\/api$/, "")}/contacts/${id}`, created: true };
    this.#idempotentRecords.set(idempotencyKey, record);
    return record;
  }

  async createDeal(input: CRMDealInput, idempotencyKey: string): Promise<CRMDealRecord> {
    const replay = this.#idempotentRecords.get(idempotencyKey);
    if (replay && "stage" in replay) return replay;
    const stageId = await this.#resolveStageId(input.stage);
    const response = await requestJson<{ deal: unknown }>(this.name, `${this.#baseUrl}/deals`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify(mapDealToFreshworks(input, stageId)),
    });
    const id = readId(response.deal, "deal");
    const record: CRMDealRecord = {
      id,
      url: `${this.#baseUrl.replace(/\/api$/, "")}/deals/${id}`,
      created: true,
      stage: input.stage,
      amount: input.amount,
    };
    this.#dealStages.set(id, input.stage);
    this.#idempotentRecords.set(idempotencyKey, record);
    return record;
  }

  async updateDealStage(dealId: string, stage: string, amount?: number): Promise<CRMDealRecord> {
    const dealStageId = await this.#resolveStageId(stage);
    const response = await requestJson<{ deal: unknown }>(this.name, `${this.#baseUrl}/deals/${encodeURIComponent(dealId)}`, {
      method: "PUT",
      headers: this.#headers,
      body: JSON.stringify({ deal: { deal_stage_id: dealStageId, ...(amount !== undefined ? { amount } : {}) } }),
    });
    const id = readId(response.deal, "deal");
    this.#dealStages.set(id, stage);
    return {
      id,
      url: `${this.#baseUrl.replace(/\/api$/, "")}/deals/${id}`,
      created: false,
      stage,
      amount: amount ?? 0,
    };
  }

  async addNote(dealId: string, note: string): Promise<void> {
    await requestJson<JsonObject>(this.name, `${this.#baseUrl}/notes`, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify({ note: { description: note, targetable_type: "Deal", targetable_id: Number(dealId) } }),
    });
  }

  async getDeal(dealId: string): Promise<CRMDealRecord | null> {
    const response = await requestJson<{ deal?: { id?: number; amount?: number } }>(
      this.name,
      `${this.#baseUrl}/deals/${encodeURIComponent(dealId)}`,
      { headers: this.#headers },
    );
    if (!response.deal?.id) return null;
    return {
      id: String(response.deal.id),
      url: `${this.#baseUrl.replace(/\/api$/, "")}/deals/${response.deal.id}`,
      created: false,
      stage: this.#dealStages.get(String(response.deal.id)) ?? "Unknown",
      amount: response.deal.amount ?? 0,
    };
  }

  async listDeals(limit = 100): Promise<CRMDealSummary[]> {
    await this.#loadStageIds();
    const filters = await requestJson<{ filters?: Array<{ id?: string | number; is_default?: boolean }> }>(
      this.name,
      `${this.#baseUrl}/deals/filters`,
      { headers: this.#headers },
    );
    const view = filters.filters?.find((filter) => filter.is_default) ?? filters.filters?.[0];
    if (view?.id === undefined || view.id === null) {
      throw new Error("Freshworks did not expose a readable deals view for this API key.");
    }
    const response = await requestJson<{ deals?: FreshworksDeal[] }>(
      this.name,
      `${this.#baseUrl}/deals/view/${encodeURIComponent(String(view.id))}?per_page=${Math.min(Math.max(limit, 1), 100)}&sort=updated_at&sort_type=desc`,
      { headers: this.#headers },
    );
    const stageById = new Map([...this.#stageIds.entries()].map(([name, id]) => [String(id), name]));
    return (response.deals ?? []).flatMap((deal): CRMDealSummary[] => {
      if (deal.id === undefined || deal.id === null || !deal.name) return [];
      const contact = deal.contacts?.[0];
      const contactName = contact?.display_name ?? ([contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || null);
      const stageId = deal.deal_stage?.id ?? deal.deal_stage_id;
      return [{
        id: String(deal.id),
        name: deal.name,
        amount: Number(deal.amount) || 0,
        stage: deal.deal_stage?.name ?? (stageId === undefined ? "Unassigned" : stageById.get(String(stageId)) ?? "Unassigned"),
        accountName: deal.sales_account?.name ?? null,
        contactName,
        updatedAt: deal.updated_at ?? null,
        url: `${this.#baseUrl.replace(/\/api$/, "")}/deals/${deal.id}`,
      }];
    });
  }

  getConsoleUrl(): string {
    return this.#baseUrl.replace(/\/api$/, "");
  }

  async health(): Promise<IntegrationHealth> {
    try {
      await this.#loadStageIds();
      return {
        integration: "crm",
        provider: this.name,
        mode: this.mode,
        status: "CONNECTED",
        message: "Freshworks authenticated successfully and deal stages are readable.",
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        integration: "crm",
        provider: this.name,
        mode: this.mode,
        status: "DEGRADED",
        message: "Freshworks credentials are configured, but the connection check failed.",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async #resolveStageId(stage: string): Promise<number> {
    const aliases: Record<string, string[]> = {
      qualified: ["qualified", "new"],
      negotiating: ["negotiating", "negotiation"],
      "deal won": ["deal won", "won"],
      deployed: ["deployed"],
    };
    const candidates = aliases[stage.toLowerCase()] ?? [stage.toLowerCase()];
    let match = candidates.map((name) => this.#stageIds.get(name)).find((id) => id !== undefined);
    if (match !== undefined) return match;
    await this.#loadStageIds();
    match = candidates.map((name) => this.#stageIds.get(name)).find((id) => id !== undefined);
    if (match === undefined) {
      throw new Error(`Freshworks deal stage "${stage}" is not configured in the selected pipeline.`);
    }
    return match;
  }

  async #loadStageIds(): Promise<void> {
    const response = await requestJson<{ deal_stages?: Array<{ id?: number; name?: string }> }>(
      this.name,
      `${this.#baseUrl}/selector/deal_stages`,
      { headers: this.#headers },
    );
    for (const stage of response.deal_stages ?? []) {
      if (typeof stage.id === "number" && stage.name) this.#stageIds.set(stage.name.toLowerCase(), stage.id);
    }
  }
}

export class DemoCRMProvider implements CRMProvider {
  readonly name = "AgentFront Demo CRM";
  readonly mode = "DEMO" as const;
  readonly #records = new Map<string, CRMRecord | CRMDealRecord>();
  readonly #deals = new Map<string, CRMDealRecord>();
  readonly #notes = new Map<string, string[]>();

  async createAccount(input: CRMAccountInput, idempotencyKey: string): Promise<CRMRecord> {
    return this.#create(idempotencyKey, `demo-account-${input.projectId}`);
  }

  async createContact(input: CRMContactInput, idempotencyKey: string): Promise<CRMRecord> {
    return this.#create(idempotencyKey, `demo-contact-${input.projectId}`);
  }

  async createDeal(input: CRMDealInput, idempotencyKey: string): Promise<CRMDealRecord> {
    const replay = this.#records.get(idempotencyKey);
    if (replay && "stage" in replay) return structuredClone(replay);
    const deal: CRMDealRecord = {
      id: `demo-deal-${input.projectId}`,
      url: null,
      created: true,
      stage: input.stage,
      amount: input.amount,
    };
    this.#records.set(idempotencyKey, deal);
    this.#deals.set(deal.id, deal);
    return structuredClone(deal);
  }

  async updateDealStage(dealId: string, stage: string, amount?: number): Promise<CRMDealRecord> {
    const deal = this.#deals.get(dealId);
    if (!deal) throw new Error(`Demo CRM deal ${dealId} was not found.`);
    deal.stage = stage;
    if (amount !== undefined) deal.amount = amount;
    deal.created = false;
    return structuredClone(deal);
  }

  async addNote(dealId: string, note: string): Promise<void> {
    const notes = this.#notes.get(dealId) ?? [];
    notes.push(note);
    this.#notes.set(dealId, notes);
  }

  async getDeal(dealId: string): Promise<CRMDealRecord | null> {
    const deal = this.#deals.get(dealId);
    return deal ? structuredClone(deal) : null;
  }

  async listDeals(): Promise<CRMDealSummary[]> {
    return [...this.#deals.values()].map((deal) => ({
      id: deal.id,
      name: deal.id.replace(/^demo-deal-/, ""),
      amount: deal.amount,
      stage: deal.stage,
      accountName: null,
      contactName: null,
      updatedAt: null,
      url: null,
    }));
  }

  getConsoleUrl(): null {
    return null;
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "crm",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: "Local idempotent CRM adapter active; no external records are created.",
      checkedAt: new Date().toISOString(),
    };
  }

  #create(idempotencyKey: string, id: string): CRMRecord {
    const replay = this.#records.get(idempotencyKey);
    if (replay) return structuredClone(replay);
    const record: CRMRecord = { id, url: null, created: true };
    this.#records.set(idempotencyKey, record);
    return structuredClone(record);
  }
}
