import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { WorkflowRepository } from "@agentfront/orchestration";
import type {
  AgentEvent,
  Business,
  Campaign,
  DashboardMetrics,
  LeadAggregate,
  PipelineTransition,
  RevenueEvent,
} from "@agentfront/types";
import { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  mapPersistedAgentEvent,
  mapPersistedBusiness,
  mapPersistedCampaign,
  mapPersistedLeadAggregate,
} from "./prisma-mappers";

const aggregateInclude = {
  business: true,
  campaign: true,
  conversations: { orderBy: [{ startedAt: "desc" }, { id: "desc" }] },
  requirements: true,
  deal: { include: { revenueEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } },
  project: { include: { deployment: true } },
  transitions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  agentEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.LeadInclude;

type TransactionClient = Prisma.TransactionClient;

export interface PersistenceHealth {
  mode: "POSTGRESQL";
  durable: true;
  status: "CONNECTED" | "DEGRADED";
  message: string;
}

export interface PrismaAgentFrontStoreOptions {
  databaseUrl?: string;
  client?: PrismaClient;
  year?: number;
}

const date = (value: string): Date => new Date(value);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const nullableJson = (value: unknown | null): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === null ? Prisma.DbNull : json(value);

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function persistenceFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function transitionSnapshot(transition: PipelineTransition): Record<string, unknown> {
  return {
    id: transition.id,
    leadId: transition.leadId,
    projectId: transition.projectId,
    from: transition.from,
    to: transition.to,
    actor: transition.actor,
    reason: transition.reason,
    idempotencyKey: transition.idempotencyKey,
    metadata: transition.metadata,
    createdAt: transition.createdAt,
  };
}

function eventSnapshot(event: AgentEvent): Record<string, unknown> {
  return {
    id: event.id,
    leadId: event.leadId,
    projectId: event.projectId,
    campaignId: event.campaignId,
    agentType: event.agentType,
    eventType: event.eventType,
    message: event.message,
    metadata: event.metadata,
    status: event.status,
    durationMs: event.durationMs,
    createdAt: event.createdAt,
  };
}

function revenueSnapshot(event: RevenueEvent): Record<string, unknown> {
  return {
    id: event.id,
    dealId: event.dealId,
    amount: event.amount,
    currency: event.currency,
    type: event.type,
    createdAt: event.createdAt,
  };
}

function leadSnapshot(lead: LeadAggregate["lead"]): Record<string, unknown> {
  return {
    id: lead.id,
    projectId: lead.projectId,
    businessId: lead.businessId,
    campaignId: lead.campaignId,
    opportunityScore: lead.opportunityScore,
    scoreBreakdown: lead.scoreBreakdown,
    qualificationReason: lead.qualificationReason,
    status: lead.status,
    freshworksAccountId: lead.freshworksAccountId,
    freshworksContactId: lead.freshworksContactId,
    freshworksDealId: lead.freshworksDealId,
    version: lead.version,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function businessCreateData(business: Business): Prisma.BusinessUncheckedCreateInput {
  return {
    id: business.id,
    externalPlaceId: business.externalPlaceId,
    name: business.name,
    category: business.category,
    address: business.address,
    city: business.city,
    latitude: business.latitude,
    longitude: business.longitude,
    phone: business.phone,
    rating: business.rating,
    reviewCount: business.reviewCount,
    website: business.website,
    googleMapsUrl: business.googleMapsUrl,
    socialLinks: json(business.socialLinks),
    digitalPresenceStatus: business.digitalPresenceStatus,
    onlineOrdering: business.onlineOrdering,
    reservationSystem: business.reservationSystem,
    source: business.source,
    createdAt: date(business.createdAt),
  };
}

function businessUpdateData(business: Business): Prisma.BusinessUncheckedUpdateInput {
  const { id: _id, ...data } = businessCreateData(business);
  return data;
}

function campaignCreateData(campaign: Campaign): Prisma.CampaignUncheckedCreateInput {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    businessTypes: json(campaign.businessTypes),
    locations: json(campaign.locations),
    qualificationPolicy: json(campaign.qualificationPolicy),
    minimumOpportunityScore: campaign.minimumOpportunityScore,
    pricingPolicy: json(campaign.pricingPolicy),
    maximumCallsPerDay: campaign.maximumCallsPerDay,
    callingWindow: json(campaign.callingWindow),
    automaticProcessing: campaign.automaticProcessing,
    createdAt: date(campaign.createdAt),
    startedAt: campaign.startedAt ? date(campaign.startedAt) : null,
    stoppedAt: campaign.stoppedAt ? date(campaign.stoppedAt) : null,
  };
}

function campaignUpdateData(campaign: Campaign): Prisma.CampaignUncheckedUpdateInput {
  const { id: _id, ...data } = campaignCreateData(campaign);
  return data;
}

async function upsertBusiness(client: TransactionClient, business: Business): Promise<void> {
  await client.business.upsert({
    where: { id: business.id },
    create: businessCreateData(business),
    update: businessUpdateData(business),
  });
}

async function upsertCampaign(client: TransactionClient, campaign: Campaign): Promise<void> {
  await client.campaign.upsert({
    where: { id: campaign.id },
    create: campaignCreateData(campaign),
    update: campaignUpdateData(campaign),
  });
}

async function ensureBusiness(client: TransactionClient, business: Business): Promise<void> {
  await client.business.upsert({
    where: { id: business.id },
    create: businessCreateData(business),
    update: {},
  });
}

async function ensureCampaign(client: TransactionClient, campaign: Campaign): Promise<void> {
  await client.campaign.upsert({
    where: { id: campaign.id },
    create: campaignCreateData(campaign),
    update: {},
  });
}

export class PrismaAgentFrontStore implements WorkflowRepository {
  readonly #client: PrismaClient;
  readonly #year: number;

  constructor(options: PrismaAgentFrontStoreOptions = {}) {
    const year = options.year ?? new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 2020 || year > 9999) throw new Error("Invalid project ID year.");
    const databaseUrl = options.databaseUrl?.trim() || process.env.DATABASE_URL?.trim();
    if (!options.client && !databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL persistence.");
    this.#client = options.client ?? new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, connectionTimeoutMillis: 5_000 }),
    });
    this.#year = year;
  }

  async disconnect(): Promise<void> {
    await this.#client.$disconnect();
  }

  async health(): Promise<PersistenceHealth> {
    try {
      await this.#client.$queryRaw`SELECT 1`;
      return { mode: "POSTGRESQL", durable: true, status: "CONNECTED", message: "PostgreSQL persistence is reachable." };
    } catch {
      return { mode: "POSTGRESQL", durable: true, status: "DEGRADED", message: "PostgreSQL persistence is configured but unreachable." };
    }
  }

  async nextProjectId(): Promise<string> {
    const sequence = await this.#client.projectSequence.upsert({
      where: { year: this.#year },
      create: { year: this.#year, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const allocated = sequence.nextValue - 1;
    if (allocated > 999_999) throw new Error(`Project ID sequence exhausted for ${this.#year}.`);
    return `AF-${this.#year}-${String(allocated).padStart(6, "0")}`;
  }

  async findByLeadId(leadId: string): Promise<LeadAggregate | null> {
    const row = await this.#client.lead.findUnique({ where: { id: leadId }, include: aggregateInclude });
    return row ? mapPersistedLeadAggregate(row) : null;
  }

  async findByProjectId(projectId: string): Promise<LeadAggregate | null> {
    const row = await this.#client.lead.findUnique({ where: { projectId }, include: aggregateInclude });
    return row ? mapPersistedLeadAggregate(row) : null;
  }

  async findByBusinessAndCampaign(businessId: string, campaignId: string): Promise<LeadAggregate | null> {
    const row = await this.#client.lead.findUnique({
      where: { businessId_campaignId: { businessId, campaignId } },
      include: aggregateInclude,
    });
    return row ? mapPersistedLeadAggregate(row) : null;
  }

  async getCampaignStatus(campaignId: string): Promise<Campaign["status"] | null> {
    const row = await this.#client.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    return row?.status ?? null;
  }

  async save(aggregate: LeadAggregate): Promise<void> {
    this.#validateAggregate(aggregate);
    await this.#client.$transaction(async (transaction) => {
      // Reference records are canonical outside the aggregate. In particular, an emergency-stop
      // status must not be overwritten by a workflow snapshot that was loaded before the stop.
      await ensureBusiness(transaction, aggregate.business);
      await ensureCampaign(transaction, aggregate.campaign);
      const workflow = await transaction.workflow.upsert({ where: { businessId: aggregate.business.id }, create: {
        id: `workflow-${aggregate.business.id}`, businessId: aggregate.business.id,
        correlationId: aggregate.business.id,
      }, update: {} });

      const storedLead = await transaction.lead.findUnique({ where: { id: aggregate.lead.id } });
      if (storedLead && (
        storedLead.projectId !== aggregate.lead.projectId ||
        storedLead.businessId !== aggregate.lead.businessId ||
        storedLead.campaignId !== aggregate.lead.campaignId
      )) {
        throw new Error(`Lead ${aggregate.lead.id} immutable identity fields do not match persisted state.`);
      }
      if (storedLead && storedLead.version > aggregate.lead.version) {
        throw new Error(`Lead ${aggregate.lead.id} is stale (persisted version ${storedLead.version}, received ${aggregate.lead.version}).`);
      }
      if (storedLead && storedLead.version === aggregate.lead.version) {
        const restoredLead = {
          ...storedLead,
          scoreBreakdown: storedLead.scoreBreakdown as unknown as LeadAggregate["lead"]["scoreBreakdown"],
          createdAt: storedLead.createdAt.toISOString(),
          updatedAt: storedLead.updatedAt.toISOString(),
        } as LeadAggregate["lead"];
        if (persistenceFingerprint(leadSnapshot(restoredLead)) !== persistenceFingerprint(leadSnapshot(aggregate.lead))) {
          throw new Error(`Lead ${aggregate.lead.id} has conflicting data for version ${aggregate.lead.version}.`);
        }
      }
      const leadData = {
        projectId: aggregate.lead.projectId,
        businessId: aggregate.lead.businessId,
        campaignId: aggregate.lead.campaignId,
        opportunityScore: aggregate.lead.opportunityScore,
        scoreBreakdown: json(aggregate.lead.scoreBreakdown),
        qualificationReason: aggregate.lead.qualificationReason,
        status: aggregate.lead.status,
        freshworksAccountId: aggregate.lead.freshworksAccountId,
        freshworksContactId: aggregate.lead.freshworksContactId,
        freshworksDealId: aggregate.lead.freshworksDealId,
        version: aggregate.lead.version,
        createdAt: date(aggregate.lead.createdAt),
        updatedAt: date(aggregate.lead.updatedAt),
      } satisfies Prisma.LeadUncheckedUpdateInput;
      await transaction.lead.upsert({
        where: { id: aggregate.lead.id },
        create: { id: aggregate.lead.id, ...leadData } as Prisma.LeadUncheckedCreateInput,
        update: leadData,
      });

      await this.#saveConversation(transaction, aggregate);
      await this.#saveRequirements(transaction, aggregate);
      await this.#saveDeal(transaction, aggregate);
      await this.#saveProject(transaction, aggregate);
      await this.#appendTransitions(transaction, aggregate.transitions);
      await this.#appendEvents(transaction, aggregate.events, aggregate.business.id, workflow.id);
      await this.#appendRevenue(transaction, aggregate.revenueEvents);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(): Promise<LeadAggregate[]> {
    const rows = await this.#client.lead.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: aggregateInclude });
    return rows.map(mapPersistedLeadAggregate);
  }

  async getBusiness(id: string): Promise<Business | null> {
    const row = await this.#client.business.findUnique({ where: { id } });
    return row ? mapPersistedBusiness(row) : null;
  }

  async listBusinesses(): Promise<Business[]> {
    const rows = await this.#client.business.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(mapPersistedBusiness);
  }

  async upsertBusinesses(businesses: readonly Business[]): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      for (const business of businesses) await upsertBusiness(transaction, business);
    });
  }

  /** Removes obsolete fake seed records while preserving every real provider record. */
  async pruneDemoBusinessesExcept(allowedBusinessId: string): Promise<number> {
    return this.#client.$transaction(async (transaction) => {
      const targets = await transaction.business.findMany({
        where: { source: "DEMO", id: { not: allowedBusinessId } },
        select: { id: true },
      });
      const ids = targets.map(({ id }) => id);
      if (!ids.length) return 0;
      const workflows = await transaction.workflow.findMany({
        where: { businessId: { in: ids } }, select: { id: true },
      });
      const workflowIds = workflows.map(({ id }) => id);
      if (workflowIds.length) {
        await transaction.agentRun.deleteMany({ where: { workflowId: { in: workflowIds } } });
        await transaction.agentEvent.updateMany({ where: { workflowId: { in: workflowIds } }, data: { workflowId: null } });
        await transaction.salesJob.updateMany({ where: { workflowId: { in: workflowIds } }, data: { workflowId: null } });
        await transaction.workflow.deleteMany({ where: { id: { in: workflowIds } } });
      }
      await transaction.agentEvent.deleteMany({ where: { businessId: { in: ids } } });
      await transaction.lead.deleteMany({ where: { businessId: { in: ids } } });
      const deleted = await transaction.business.deleteMany({ where: { id: { in: ids } } });
      return deleted.count;
    });
  }

  async upsertCampaigns(campaigns: readonly Campaign[]): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      for (const campaign of campaigns) await upsertCampaign(transaction, campaign);
    });
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const row = await this.#client.campaign.findUnique({ where: { id } });
    return row ? mapPersistedCampaign(row) : null;
  }

  async listCampaigns(): Promise<Campaign[]> {
    const rows = await this.#client.campaign.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(mapPersistedCampaign);
  }

  async updateCampaignStatus(id: string, status: Campaign["status"]): Promise<Campaign | null> {
    return this.#client.$transaction(async (transaction) => {
      const existing = await transaction.campaign.findUnique({ where: { id } });
      if (!existing) return null;
      const now = new Date();
      const updated = await transaction.campaign.update({
        where: { id },
        data: {
          status,
          startedAt: status === "RUNNING" ? existing.startedAt ?? now : existing.startedAt,
          stoppedAt: status === "STOPPED" ? now : existing.stoppedAt,
        },
      });
      return mapPersistedCampaign(updated);
    });
  }

  async listEvents(limit = 100): Promise<AgentEvent[]> {
    const rows = await this.#client.agentEvent.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.max(0, limit),
    });
    return rows.map(mapPersistedAgentEvent);
  }

  async dashboardMetrics(): Promise<DashboardMetrics> {
    const [aggregates, businessesDiscovered] = await Promise.all([this.list(), this.#client.business.count()]);
    const won = aggregates.filter((aggregate) => aggregate.deal?.status === "WON");
    const revenueEarned = won.reduce((sum, aggregate) => sum + (aggregate.deal?.finalAmount ?? 0), 0);
    const estimatedPipelineValue = aggregates
      .filter((aggregate) => !["DEPLOYED", "DEAL_LOST", "REJECTED", "NOT_INTERESTED"].includes(aggregate.lead.status))
      .reduce((sum, aggregate) => sum + (aggregate.deal?.quotedAmount || aggregate.campaign.pricingPolicy.basePrice), 0);
    return {
      revenueEarned,
      estimatedPipelineValue,
      businessesDiscovered,
      qualifiedLeads: aggregates.filter((aggregate) => aggregate.lead.opportunityScore >= aggregate.campaign.minimumOpportunityScore).length,
      conversationsCompleted: aggregates.filter((aggregate) => aggregate.conversation?.status === "COMPLETED").length,
      dealsWon: won.length,
      conversionRate: aggregates.length === 0 ? 0 : Math.round((won.length / aggregates.length) * 10_000) / 100,
      websitesDeployed: aggregates.filter((aggregate) => aggregate.lead.status === "DEPLOYED").length,
      currency: "INR",
    };
  }

  #validateAggregate(aggregate: LeadAggregate): void {
    if (aggregate.lead.businessId !== aggregate.business.id || aggregate.lead.campaignId !== aggregate.campaign.id) {
      throw new Error(`Lead ${aggregate.lead.id} reference data does not match its foreign keys.`);
    }
    if (aggregate.project && aggregate.project.leadId !== aggregate.lead.id) throw new Error("Project belongs to another lead.");
    if (aggregate.project && aggregate.project.projectId !== aggregate.lead.projectId) throw new Error("Project ID does not match the lead.");
    if (aggregate.deal && aggregate.deal.leadId !== aggregate.lead.id) throw new Error("Deal belongs to another lead.");
    if (aggregate.conversation && aggregate.conversation.leadId !== aggregate.lead.id) throw new Error("Conversation belongs to another lead.");
    if (aggregate.requirements && aggregate.requirements.leadId !== aggregate.lead.id) throw new Error("Requirements belong to another lead.");
    if (aggregate.deployment && (!aggregate.project || aggregate.deployment.projectId !== aggregate.project.id)) {
      throw new Error("Deployment belongs to another project.");
    }
    for (const transition of aggregate.transitions) {
      if (transition.leadId !== aggregate.lead.id || transition.projectId !== aggregate.lead.projectId) {
        throw new Error(`Transition ${transition.id} belongs to another workflow.`);
      }
    }
    for (const event of aggregate.events) {
      if (
        event.leadId !== aggregate.lead.id ||
        (event.projectId !== null && event.projectId !== aggregate.lead.projectId) ||
        (event.campaignId !== null && event.campaignId !== aggregate.lead.campaignId)
      ) {
        throw new Error(`Agent event ${event.id} belongs to another workflow.`);
      }
    }
    for (const event of aggregate.revenueEvents) {
      if (!aggregate.deal || event.dealId !== aggregate.deal.id) throw new Error(`Revenue event ${event.id} belongs to another deal.`);
    }
  }

  async #saveConversation(transaction: TransactionClient, aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.conversation) {
      return;
    }
    const conversation = aggregate.conversation;
    const data = {
      leadId: aggregate.lead.id,
      provider: conversation.provider,
      providerMode: conversation.providerMode,
      providerConversationId: conversation.providerConversationId,
      clientToken: conversation.clientToken,
      providerUrl: conversation.providerUrl,
      status: conversation.status,
      transcript: json(conversation.transcript),
      summary: conversation.summary,
      sentiment: conversation.sentiment,
      startedAt: conversation.startedAt ? date(conversation.startedAt) : null,
      endedAt: conversation.endedAt ? date(conversation.endedAt) : null,
    } satisfies Prisma.ConversationUncheckedUpdateInput;
    await transaction.conversation.upsert({
      where: { id: conversation.id },
      create: { id: conversation.id, ...data } as Prisma.ConversationUncheckedCreateInput,
      update: data,
    });
  }

  async #saveRequirements(transaction: TransactionClient, aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.requirements) {
      return;
    }
    const requirements = aggregate.requirements;
    const stored = await transaction.requirements.findUnique({ where: { leadId: aggregate.lead.id }, select: { id: true } });
    if (stored && stored.id !== requirements.id) throw new Error("Requirements identity conflicts with persisted state.");
    const data = {
      leadId: aggregate.lead.id,
      businessType: requirements.businessType,
      pages: json(requirements.pages),
      features: json(requirements.features),
      branding: json(requirements.branding),
      contentRequirements: json(requirements.contentRequirements),
      budget: json(requirements.budget),
      notes: json(requirements.notes),
      approvedAt: requirements.approvedAt ? date(requirements.approvedAt) : null,
    } satisfies Prisma.RequirementsUncheckedUpdateInput;
    await transaction.requirements.upsert({
      where: { leadId: aggregate.lead.id },
      create: { id: requirements.id, ...data } as Prisma.RequirementsUncheckedCreateInput,
      update: data,
    });
  }

  async #saveDeal(transaction: TransactionClient, aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.deal) {
      return;
    }
    const deal = aggregate.deal;
    const stored = await transaction.deal.findUnique({ where: { leadId: aggregate.lead.id }, select: { id: true } });
    if (stored && stored.id !== deal.id) throw new Error("Deal identity conflicts with persisted state.");
    const data = {
      leadId: aggregate.lead.id,
      quotedAmount: deal.quotedAmount,
      discount: deal.discount,
      finalAmount: deal.finalAmount,
      currency: deal.currency,
      status: deal.status,
      acceptedAt: deal.acceptedAt ? date(deal.acceptedAt) : null,
      lostReason: deal.lostReason,
    } satisfies Prisma.DealUncheckedUpdateInput;
    await transaction.deal.upsert({
      where: { leadId: aggregate.lead.id },
      create: { id: deal.id, ...data } as Prisma.DealUncheckedCreateInput,
      update: data,
    });
  }

  async #saveProject(transaction: TransactionClient, aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.project) {
      return;
    }
    const project = aggregate.project;
    const stored = await transaction.project.findUnique({ where: { leadId: aggregate.lead.id }, select: { id: true } });
    if (stored && stored.id !== project.id) throw new Error("Project identity conflicts with persisted state.");
    const data = {
      projectId: project.projectId,
      leadId: aggregate.lead.id,
      templateType: project.templateType,
      specification: nullableJson(project.specification),
      status: project.status,
      buildPath: project.buildPath,
      buildLog: json(project.buildLog),
      qaStatus: project.qaStatus,
      qaResult: nullableJson(project.qaResult),
      createdAt: date(project.createdAt),
      updatedAt: date(project.updatedAt),
    } satisfies Prisma.ProjectUncheckedUpdateInput;
    await transaction.project.upsert({
      where: { leadId: aggregate.lead.id },
      create: { id: project.id, ...data } as Prisma.ProjectUncheckedCreateInput,
      update: data,
    });
    if (!aggregate.deployment) {
      return;
    }
    const deployment = aggregate.deployment;
    const storedDeployment = await transaction.deployment.findUnique({ where: { projectId: project.id }, select: { id: true } });
    if (storedDeployment && storedDeployment.id !== deployment.id) throw new Error("Deployment identity conflicts with persisted state.");
    const deploymentData = {
      projectId: project.id,
      provider: deployment.provider,
      providerMode: deployment.providerMode,
      url: deployment.url,
      status: deployment.status,
      deployedAt: deployment.deployedAt ? date(deployment.deployedAt) : null,
    } satisfies Prisma.DeploymentUncheckedUpdateInput;
    await transaction.deployment.upsert({
      where: { id: deployment.id },
      create: { id: deployment.id, ...deploymentData } as Prisma.DeploymentUncheckedCreateInput,
      update: deploymentData,
    });
  }

  async #appendTransitions(transaction: TransactionClient, transitions: readonly PipelineTransition[]): Promise<void> {
    for (const transition of transitions) {
      const snapshot = transitionSnapshot(transition);
      const fingerprint = persistenceFingerprint(snapshot);
      const idempotency = await transaction.idempotencyRecord.upsert({
        where: { key: transition.idempotencyKey },
        create: {
          key: transition.idempotencyKey,
          operation: "pipeline.transition",
          fingerprint,
          response: json({ transitionId: transition.id }),
        },
        update: {},
      });
      if (idempotency.operation !== "pipeline.transition" || idempotency.fingerprint !== fingerprint) {
        throw new Error(`Idempotency key ${transition.idempotencyKey} conflicts with persisted transition data.`);
      }
      const persisted = await transaction.pipelineTransition.upsert({
        where: { id: transition.id },
        create: {
          id: transition.id,
          leadId: transition.leadId,
          projectId: transition.projectId,
          from: transition.from,
          to: transition.to,
          actor: transition.actor,
          reason: transition.reason,
          idempotencyKey: transition.idempotencyKey,
          metadata: json(transition.metadata),
          createdAt: date(transition.createdAt),
        },
        update: {},
      });
      if (persistenceFingerprint(transitionSnapshot({
        ...transition,
        ...persisted,
        createdAt: persisted.createdAt.toISOString(),
        actor: persisted.actor as PipelineTransition["actor"],
        metadata: persisted.metadata as Record<string, unknown>,
      })) !== fingerprint) {
        throw new Error(`Transition ${transition.id} conflicts with its persisted append-only record.`);
      }
    }
  }

  async #appendEvents(transaction: TransactionClient, events: readonly AgentEvent[], businessId: string, workflowId: string): Promise<void> {
    for (const event of events) {
      const persisted = await transaction.agentEvent.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          businessId,
          workflowId,
          correlationId: event.projectId ?? businessId,
          sourceAgent: event.agentType === "DISCOVERY" || event.agentType === "QUALIFICATION" ? "DISCOVER"
            : ["CRM", "SALES", "NEGOTIATION"].includes(event.agentType) ? "SALES"
            : ["SPECIFICATION", "DEVELOPER", "QA", "DEPLOYMENT"].includes(event.agentType) ? "DEVELOPER"
            : "DELIVERY",
          retryCount: event.retryCount ?? 0,
          payload: json(event.metadata),
          leadId: event.leadId,
          projectId: event.projectId,
          campaignId: event.campaignId,
          agentType: event.agentType,
          eventType: event.eventType,
          message: event.message,
          metadata: json(event.metadata),
          status: event.status,
          durationMs: event.durationMs,
          createdAt: date(event.createdAt),
        },
        update: {},
      });
      const restored: AgentEvent = {
        ...event,
        ...persisted,
        agentType: persisted.agentType as AgentEvent["agentType"],
        sourceAgent: persisted.sourceAgent as AgentEvent["sourceAgent"],
        payload: persisted.payload as AgentEvent["payload"],
        createdAt: persisted.createdAt.toISOString(),
        metadata: persisted.metadata as Record<string, unknown>,
      };
      if (persistenceFingerprint(eventSnapshot(restored)) !== persistenceFingerprint(eventSnapshot(event))) {
        throw new Error(`Agent event ${event.id} conflicts with its persisted append-only record.`);
      }
    }
  }

  async #appendRevenue(transaction: TransactionClient, events: readonly RevenueEvent[]): Promise<void> {
    for (const event of events) {
      const persisted = await transaction.revenueEvent.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          dealId: event.dealId,
          amount: event.amount,
          currency: event.currency,
          type: event.type,
          createdAt: date(event.createdAt),
        },
        update: {},
      });
      const restored: RevenueEvent = {
        ...persisted,
        currency: persisted.currency as RevenueEvent["currency"],
        type: persisted.type as RevenueEvent["type"],
        createdAt: persisted.createdAt.toISOString(),
      };
      if (persistenceFingerprint(revenueSnapshot(restored)) !== persistenceFingerprint(revenueSnapshot(event))) {
        throw new Error(`Revenue event ${event.id} conflicts with its persisted append-only record.`);
      }
    }
  }
}
