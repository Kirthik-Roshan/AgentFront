import { ProjectIdSequence } from "@agentfront/orchestration";
import type { WorkflowRepository } from "@agentfront/orchestration";
import type {
  AgentEvent,
  Business,
  Campaign,
  DashboardMetrics,
  LeadAggregate,
} from "@agentfront/types";
import { demoBusinesses, demoCampaign } from "./demo-data";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryAgentFrontStore implements WorkflowRepository {
  readonly #businesses = new Map<string, Business>();
  readonly #campaigns = new Map<string, Campaign>();
  readonly #aggregates = new Map<string, LeadAggregate>();
  readonly #projects = new Map<string, string>();
  readonly #pairs = new Map<string, string>();
  readonly #sequence: ProjectIdSequence;

  constructor(options: { businesses?: Business[]; campaigns?: Campaign[]; year?: number } = {}) {
    for (const business of options.businesses ?? demoBusinesses) this.#businesses.set(business.id, clone(business));
    for (const campaign of options.campaigns ?? [demoCampaign]) this.#campaigns.set(campaign.id, clone(campaign));
    const isCanonicalDemoStore = options.businesses === undefined && options.campaigns === undefined;
    this.#sequence = new ProjectIdSequence(options.year ?? (isCanonicalDemoStore ? 2026 : new Date().getUTCFullYear()));
  }

  async nextProjectId(): Promise<string> {
    return this.#sequence.next();
  }

  async findByLeadId(leadId: string): Promise<LeadAggregate | null> {
    const aggregate = this.#aggregates.get(leadId);
    return aggregate ? clone(aggregate) : null;
  }

  async findByProjectId(projectId: string): Promise<LeadAggregate | null> {
    const leadId = this.#projects.get(projectId);
    return leadId ? this.findByLeadId(leadId) : null;
  }

  async findByBusinessAndCampaign(businessId: string, campaignId: string): Promise<LeadAggregate | null> {
    const leadId = this.#pairs.get(`${businessId}:${campaignId}`);
    return leadId ? this.findByLeadId(leadId) : null;
  }

  async getCampaignStatus(campaignId: string): Promise<Campaign["status"] | null> {
    return this.#campaigns.get(campaignId)?.status ?? null;
  }

  async save(aggregate: LeadAggregate): Promise<void> {
    const pair = `${aggregate.lead.businessId}:${aggregate.lead.campaignId}`;
    const conflictingLeadId = this.#pairs.get(pair);
    if (conflictingLeadId && conflictingLeadId !== aggregate.lead.id) {
      throw new Error(`A lead already exists for business/campaign pair ${pair}.`);
    }
    // Match PostgreSQL's ensure-reference behavior for dynamically created
    // sales-delivery campaigns without overwriting an operator's later pause.
    if (!this.#businesses.has(aggregate.business.id)) this.#businesses.set(aggregate.business.id, clone(aggregate.business));
    if (!this.#campaigns.has(aggregate.campaign.id)) this.#campaigns.set(aggregate.campaign.id, clone(aggregate.campaign));
    this.#aggregates.set(aggregate.lead.id, clone(aggregate));
    this.#projects.set(aggregate.lead.projectId, aggregate.lead.id);
    this.#pairs.set(pair, aggregate.lead.id);
  }

  async list(): Promise<LeadAggregate[]> {
    return [...this.#aggregates.values()].map(clone);
  }

  getBusiness(id: string): Business | null {
    const business = this.#businesses.get(id);
    return business ? clone(business) : null;
  }

  listBusinesses(): Business[] {
    return [...this.#businesses.values()].map(clone);
  }

  upsertBusinesses(businesses: readonly Business[]): void {
    for (const business of businesses) this.#businesses.set(business.id, clone(business));
  }

  getCampaign(id: string): Campaign | null {
    const campaign = this.#campaigns.get(id);
    return campaign ? clone(campaign) : null;
  }

  listCampaigns(): Campaign[] {
    return [...this.#campaigns.values()].map(clone);
  }

  updateCampaignStatus(id: string, status: Campaign["status"]): Campaign | null {
    const campaign = this.#campaigns.get(id);
    if (!campaign) return null;
    campaign.status = status;
    const now = new Date().toISOString();
    if (status === "RUNNING" && !campaign.startedAt) campaign.startedAt = now;
    if (status === "STOPPED") campaign.stoppedAt = now;
    return clone(campaign);
  }

  async listEvents(limit = 100): Promise<AgentEvent[]> {
    const events = [...this.#aggregates.values()].flatMap((aggregate) => aggregate.events);
    return events
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(0, limit))
      .map(clone);
  }

  async dashboardMetrics(): Promise<DashboardMetrics> {
    const aggregates = await this.list();
    const won = aggregates.filter((aggregate) => aggregate.deal?.status === "WON");
    const revenueEarned = won.reduce((sum, aggregate) => sum + (aggregate.deal?.finalAmount ?? 0), 0);
    const estimatedPipelineValue = aggregates
      .filter((aggregate) => !["DEPLOYED", "DEAL_LOST", "REJECTED", "NOT_INTERESTED"].includes(aggregate.lead.status))
      .reduce((sum, aggregate) => sum + (aggregate.deal?.quotedAmount || aggregate.campaign.pricingPolicy.basePrice), 0);
    return {
      revenueEarned,
      estimatedPipelineValue,
      businessesDiscovered: this.#businesses.size,
      qualifiedLeads: aggregates.filter((aggregate) => aggregate.lead.opportunityScore >= aggregate.campaign.minimumOpportunityScore).length,
      conversationsCompleted: aggregates.filter((aggregate) => aggregate.conversation?.status === "COMPLETED").length,
      dealsWon: won.length,
      conversionRate: aggregates.length === 0 ? 0 : Math.round((won.length / aggregates.length) * 10_000) / 100,
      websitesDeployed: aggregates.filter((aggregate) => aggregate.lead.status === "DEPLOYED").length,
      currency: "INR",
    };
  }
}
