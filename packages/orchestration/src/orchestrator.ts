import {
  calculateOpportunityScore,
  calculateQuote,
  createProjectSpecification,
  getNegotiationOffer,
  satisfiesQualificationPolicy,
  assertValidProjectSpecification,
} from "@agentfront/scoring";
import type {
  AgentEvent,
  AgentType,
  Business,
  Campaign,
  ConversationOutcome,
  LeadAggregate,
  PipelineState,
  ProviderSet,
  ProjectFeature,
  ProjectSpecification,
  SalesBusinessDetail,
} from "@agentfront/types";
import { AgentEventBus } from "./events";
import type { WorkflowRepository } from "./repository";
import { runDeterministicQA } from "./qa";
import { PipelineStateMachine } from "./state-machine";

export interface OrchestratorOptions {
  templateRoot: string;
  outputRoot: string;
  clock?: () => Date;
  shouldPause?: () => Promise<boolean>;
}

export interface StartPipelineInput {
  business: Business;
  campaign: Campaign;
  idempotencyKey: string;
}

const clone = <T>(value: T): T => structuredClone(value);

export class AgentFrontOrchestrator {
  readonly #stateMachine = new PipelineStateMachine();
  readonly #clock: () => Date;
  readonly #inFlightStarts = new Map<string, Promise<LeadAggregate>>();
  readonly #inFlightRuns = new Map<string, Promise<LeadAggregate>>();

  constructor(
    readonly repository: WorkflowRepository,
    readonly providers: ProviderSet,
    readonly events: AgentEventBus,
    readonly options: OrchestratorOptions,
  ) {
    this.#clock = options.clock ?? (() => new Date());
  }

  async start(input: StartPipelineInput): Promise<LeadAggregate> {
    const operationKey = `${input.business.id}:${input.campaign.id}`;
    const inFlight = this.#inFlightStarts.get(operationKey);
    if (inFlight) return clone(await inFlight);
    const operation = this.#enroll(input);
    this.#inFlightStarts.set(operationKey, operation);
    try {
      return clone(await operation);
    } finally {
      this.#inFlightStarts.delete(operationKey);
    }
  }

  /**
   * Bridge the durable sales ledger into the existing developer/QA/deployment
   * pipeline. This does not replay a fictional CRM or conversation journey.
   */
  async handoffSalesSpecification(detail: SalesBusinessDetail, campaignId: string): Promise<LeadAggregate> {
    const approved = detail.projectSpec;
    if (!approved || detail.business.salesState !== "SPEC_GENERATED") {
      throw new Error("A won deal and approved sales project specification are required for delivery.");
    }
    const salesSpec = approved.specification;
    if (salesSpec.businessId !== detail.business.id || approved.businessId !== detail.business.id) {
      throw new Error("Sales specification is not bound to this business.");
    }
    const contact = detail.contacts.find((item) => item.id === approved.contactId);
    if (!contact || !contact.isDecisionMaker || !contact.verified || !contact.normalizedPhone) {
      throw new Error("Delivery requires a verified decision-maker contact with a phone number.");
    }
    const original = await this.repository.findByBusinessAndCampaign(detail.business.id, campaignId);
    if (!original) throw new Error("A qualified pipeline lead must exist before sales delivery handoff.");
    const originalHandoff = original.events.find((item) => item.eventType === "sales.specification.handed_off");
    if (originalHandoff?.metadata.salesSpecId === approved.id) return original;
    // The existing Stage-1 demo may already have built this business using a
    // different, older scope. Preserve that immutable deployment and give the
    // newly accepted sales specification its own lead/campaign identity.
    let aggregate = original;
    if (original.lead.status !== "QUALIFIED" || originalHandoff) {
      const deliveryCampaign = {
        ...original.campaign,
        id: `sales-spec-${approved.id}`,
        name: `${original.campaign.name} · Sales delivery`,
      };
      const existing = await this.repository.findByBusinessAndCampaign(detail.business.id, deliveryCampaign.id);
      aggregate = existing ?? await this.start({
        business: detail.business, campaign: deliveryCampaign,
        idempotencyKey: `sales-spec:${approved.id}:enroll`,
      });
    }
    const existingHandoff = aggregate.events.find((item) => item.eventType === "sales.specification.handed_off");
    if (existingHandoff) {
      if (existingHandoff.metadata.salesSpecId !== approved.id) throw new Error("This lead is bound to a different sales specification.");
      return aggregate;
    }
    if (aggregate.lead.status !== "QUALIFIED") {
      throw new Error(`Cannot replace an existing ${aggregate.lead.status} delivery workflow with a new sales specification.`);
    }
    const terms = salesSpec.commercial;
    if (!Number.isSafeInteger(terms.quotedPrice) || !Number.isSafeInteger(terms.agreedPrice) ||
      !terms.quotedPrice || !terms.agreedPrice || terms.agreedPrice > terms.quotedPrice) {
      throw new Error("Accepted commercial terms are incomplete or invalid.");
    }
    const supported = new Set<ProjectFeature>([
      "menu", "gallery", "whatsappOrdering", "googleMaps", "reservations", "booking",
      "testimonials", "catalog", "emergencyContact",
    ]);
    for (const [feature, enabled] of Object.entries(salesSpec.requirements.features)) {
      if (enabled && !supported.has(feature as ProjectFeature)) {
        throw new Error(`The delivery template does not support purchased feature ${feature}.`);
      }
    }
    const features = Object.fromEntries(Object.entries(salesSpec.requirements.features)
      .filter(([feature]) => supported.has(feature as ProjectFeature))) as Partial<Record<ProjectFeature, boolean>>;
    const style = typeof salesSpec.branding.style === "string" && salesSpec.branding.style.trim()
      ? salesSpec.branding.style.trim() : "modern";
    const primaryColour = typeof salesSpec.branding.primaryColour === "string" && salesSpec.branding.primaryColour.trim()
      ? salesSpec.branding.primaryColour.trim() : null;
    const vertical = detail.business.socialLinks.agentfrontVertical?.trim() || detail.business.category;
    const nicheBrief = `Business vertical: ${vertical}. Adapt the selected ${detail.business.category} template to this niche without rebuilding its architecture.`;
    const specification: ProjectSpecification = assertValidProjectSpecification({
      schemaVersion: 1, projectId: aggregate.lead.projectId,
      business: { name: detail.business.name, type: detail.business.category,
        location: `${detail.business.address}, ${detail.business.city}`, phone: salesSpec.business.phone },
      commercial: { quotedPrice: terms.quotedPrice, finalPrice: terms.agreedPrice, currency: terms.currency },
      pages: [...salesSpec.requirements.pages], features,
      clientBrief: [nicheBrief, ...salesSpec.requirements.notes.map((item) => item.trim()).filter(Boolean)].slice(0, 50),
      design: { style, ...(primaryColour ? { primaryColour } : {}), mobileFirst: true },
    });
    const now = this.#now();
    aggregate.requirements = {
      id: `requirements-${aggregate.lead.projectId}`, leadId: aggregate.lead.id,
      businessType: detail.business.category, pages: [...salesSpec.requirements.pages], features,
      branding: { style, primaryColour, mobileFirst: true },
      contentRequirements: [nicheBrief, ...salesSpec.requirements.notes],
      budget: { minimum: terms.agreedPrice, maximum: terms.quotedPrice, currency: terms.currency },
      notes: [...salesSpec.requirements.notes], approvedAt: approved.createdAt,
    };
    aggregate.deal = {
      id: `deal-${aggregate.lead.projectId}`, leadId: aggregate.lead.id,
      quotedAmount: terms.quotedPrice, discount: terms.quotedPrice - terms.agreedPrice,
      finalAmount: terms.agreedPrice, currency: terms.currency,
      status: "WON", acceptedAt: approved.createdAt, lostReason: null,
    };
    aggregate.project = {
      id: `project-${aggregate.lead.projectId}`, projectId: aggregate.lead.projectId,
      leadId: aggregate.lead.id, templateType: detail.business.category,
      specification, status: "SPEC_READY", buildPath: null, buildLog: [],
      qaStatus: "PENDING", qaResult: null, deploymentId: null, createdAt: now, updatedAt: now,
    };
    this.#transition(aggregate, "SPEC_GENERATED", "SPECIFICATION",
      "Verified sales specification handed off to the existing developer pipeline.",
      `sales-spec:${approved.id}:handoff`, { salesSpecId: approved.id });
    this.#emit(aggregate, "SPECIFICATION", "sales.specification.handed_off",
      "Verified sales deal and requirements handed to the developer pipeline.", "SUCCESS", { salesSpecId: approved.id });
    aggregate.revenueEvents.push({
      id: `revenue-${aggregate.lead.projectId}`, dealId: aggregate.deal.id,
      amount: terms.agreedPrice, currency: terms.currency, type: "BOOKED", createdAt: approved.createdAt,
    });
    await this.repository.save(aggregate);
    return clone(aggregate);
  }

  async #enroll(input: StartPipelineInput): Promise<LeadAggregate> {
    const existing = await this.repository.findByBusinessAndCampaign(input.business.id, input.campaign.id);
    if (existing) return existing;

    const projectId = await this.repository.nextProjectId();
    const now = this.#now();
    const score = calculateOpportunityScore(input.business, input.campaign.minimumOpportunityScore);
    const policyQualified =
      input.campaign.businessTypes.includes(input.business.category) &&
      satisfiesQualificationPolicy(input.business, input.campaign.qualificationPolicy);
    const qualified = score.qualified && policyQualified;
    const qualificationReason = qualified
      ? score.reason
      : policyQualified
        ? score.reason
        : "Rejected because the business does not satisfy the campaign qualification policy.";
    const leadId = `lead-${projectId}`;
    const aggregate: LeadAggregate = {
      lead: {
        id: leadId,
        projectId,
        businessId: input.business.id,
        campaignId: input.campaign.id,
        opportunityScore: score.total,
        scoreBreakdown: score.factors,
        qualificationReason,
        status: "DISCOVERED",
        freshworksAccountId: null,
        freshworksContactId: null,
        freshworksDealId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      business: clone(input.business),
      campaign: clone(input.campaign),
      conversation: null,
      requirements: null,
      deal: null,
      project: null,
      deployment: null,
      transitions: [],
      events: [],
      revenueEvents: [],
    };

    aggregate.transitions.push({
      id: `transition-${projectId}-1`,
      leadId,
      projectId,
      from: null,
      to: "DISCOVERED",
      actor: "FOUNDER",
      reason: "Founder enrolled the discovered business into the autonomous pipeline.",
      idempotencyKey: `${projectId}:${input.idempotencyKey}:discovered`,
      metadata: { businessId: input.business.id, campaignId: input.campaign.id },
      createdAt: now,
    });

    this.#emit(aggregate, "DISCOVERY", "business.enrolled", `${input.business.name} entered the AgentFront pipeline.`, "INFO");
    this.#transition(
      aggregate,
      qualified ? "QUALIFIED" : "REJECTED",
      "QUALIFICATION",
      qualificationReason,
      `${projectId}:${input.idempotencyKey}:qualification`,
      { opportunityScore: score.total },
    );
    await this.repository.save(aggregate);
    return clone(aggregate);
  }

  async run(leadId: string): Promise<LeadAggregate> {
    const inFlight = this.#inFlightRuns.get(leadId);
    if (inFlight) return clone(await inFlight);
    const operation = this.#run(leadId);
    this.#inFlightRuns.set(leadId, operation);
    try {
      return clone(await operation);
    } finally {
      this.#inFlightRuns.delete(leadId);
    }
  }

  async #run(leadId: string): Promise<LeadAggregate> {
    const found = await this.repository.findByLeadId(leadId);
    if (!found) throw new Error(`Lead ${leadId} was not found.`);
    const aggregate = clone(found);

    try {
      if (aggregate.lead.status === "QUALIFIED" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#createCRMRecords(aggregate);
      }
      if (aggregate.lead.status === "CRM_CREATED" && await this.#campaignAllowsProgress(aggregate)) {
        this.#transition(
          aggregate,
          "OUTREACH_READY",
          "ORCHESTRATOR",
          "CRM records are ready for outreach.",
          `${aggregate.lead.projectId}:outreach-ready`,
        );
        await this.repository.save(aggregate);
      }
      if (aggregate.lead.status === "OUTREACH_READY" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#startConversation(aggregate);
      }
      if (aggregate.lead.status === "CONVERSATION_ACTIVE" && await this.#campaignAllowsProgress(aggregate)) {
        const outcome = aggregate.conversation
          ? await this.providers.conversation.getOutcome(aggregate.conversation.providerConversationId)
          : null;
        if (!outcome) return clone(aggregate);
        await this.#applyConversationOutcome(aggregate, outcome);
      }
      if (aggregate.lead.status === "REQUIREMENTS_COLLECTED" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#beginNegotiation(aggregate);
      }
      if (aggregate.lead.status === "NEGOTIATING" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#closeNegotiation(aggregate);
      }
      if (aggregate.lead.status === "DEAL_WON" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#generateSpecification(aggregate);
      }
      if (aggregate.lead.status === "SPEC_GENERATED" && await this.#campaignAllowsProgress(aggregate)) {
        this.#transition(
          aggregate,
          "BUILD_QUEUED",
          "ORCHESTRATOR",
          "Validated specification queued for the developer provider.",
          `${aggregate.lead.projectId}:build-queued`,
        );
        if (aggregate.project) aggregate.project.status = "QUEUED";
        await this.repository.save(aggregate);
      }
      if (aggregate.lead.status === "BUILD_QUEUED" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#build(aggregate);
      }
      if (aggregate.lead.status === "QA" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#qualityAssure(aggregate);
      }
      if (aggregate.lead.status === "DEPLOYING" && await this.#campaignAllowsProgress(aggregate)) {
        await this.#deploy(aggregate);
      }
      if (
        aggregate.lead.status === "DEPLOYED" &&
        aggregate.deployment &&
        !aggregate.events.some((event) => event.eventType === "crm.deployment.synced") &&
        await this.#campaignAllowsProgress(aggregate)
      ) {
        await this.#synchronizeDeploymentCRM(aggregate);
      }
      return clone(aggregate);
    } catch (error) {
      await this.#recordFailure(aggregate, error);
      throw error;
    }
  }

  async completeConversation(
    leadId: string,
    outcome: ConversationOutcome,
    idempotencyKey: string,
    providerConversationId?: string,
    continuePipeline = true,
  ): Promise<LeadAggregate> {
    const found = await this.repository.findByLeadId(leadId);
    if (!found) throw new Error(`Lead ${leadId} was not found.`);
    if (found.lead.status !== "CONVERSATION_ACTIVE") return found;
    if (found.conversation?.providerMode === "REAL") {
      if (
        !providerConversationId ||
        found.conversation.providerConversationId.startsWith("pending-") ||
        found.conversation.providerConversationId !== providerConversationId
      ) {
        throw new Error("The real conversation completion does not match the bound provider conversation.");
      }
      await this.providers.conversation.getConversation(providerConversationId);
    }
    const aggregate = clone(found);
    await this.#applyConversationOutcome(aggregate, outcome, idempotencyKey);
    return continuePipeline ? this.run(leadId) : clone(aggregate);
  }

  async bindConversation(
    leadId: string,
    providerConversationId: string,
    idempotencyKey: string,
  ): Promise<LeadAggregate> {
    const found = await this.repository.findByLeadId(leadId);
    if (!found) throw new Error(`Lead ${leadId} was not found.`);
    if (found.lead.status !== "CONVERSATION_ACTIVE" || !found.conversation) {
      throw new Error(`Lead ${leadId} does not have a conversation ready to bind.`);
    }
    if (found.conversation.providerMode !== "REAL") {
      throw new Error("Demo conversations do not accept browser provider bindings.");
    }
    if (found.conversation.providerConversationId === providerConversationId) return clone(found);
    if (!found.conversation.providerConversationId.startsWith("pending-")) {
      throw new Error("The conversation is already bound to a different provider conversation.");
    }

    await this.providers.conversation.getConversation(providerConversationId);
    const aggregate = clone(found);
    const conversation = aggregate.conversation;
    if (!conversation) throw new Error(`Lead ${leadId} does not have a conversation ready to bind.`);
    conversation.providerConversationId = providerConversationId;
    conversation.status = "ACTIVE";
    conversation.startedAt = conversation.startedAt ?? this.#now();
    conversation.clientToken = null;
    conversation.providerUrl = null;
    this.#emit(
      aggregate,
      "SALES",
      "conversation.connected",
      "Realtime browser conversation connected and provider identity verified.",
      "SUCCESS",
      { providerConversationId, idempotencyKey },
    );
    await this.repository.save(aggregate);
    return clone(aggregate);
  }

  async retry(leadId: string, idempotencyKey: string, continuePipeline = true, actor: "FOUNDER" | "SYSTEM" = "FOUNDER"): Promise<LeadAggregate> {
    const found = await this.repository.findByLeadId(leadId);
    if (!found) throw new Error(`Lead ${leadId} was not found.`);
    const aggregate = clone(found);
    if (!await this.#campaignAllowsProgress(aggregate)) return clone(aggregate);
    if (aggregate.lead.status === "BUILD_FAILED") {
      this.#transition(aggregate, "BUILD_QUEUED", actor, actor === "SYSTEM" ? "Worker retried the failed sales build." : "Manual build retry requested.", idempotencyKey);
    } else if (aggregate.lead.status === "DEPLOY_FAILED") {
      this.#transition(aggregate, "DEPLOYING", actor, actor === "SYSTEM" ? "Worker retried the failed sales deployment." : "Manual deployment retry requested.", idempotencyKey);
    } else if (aggregate.lead.status === "FOLLOW_UP") {
      this.#transition(aggregate, "OUTREACH_READY", "FOUNDER", "Follow-up resumed.", idempotencyKey);
    } else {
      throw new Error(`Lead ${leadId} cannot be retried from ${aggregate.lead.status}.`);
    }
    await this.repository.save(aggregate);
    return continuePipeline ? this.run(leadId) : clone(aggregate);
  }

  async #createCRMRecords(aggregate: LeadAggregate): Promise<void> {
    const key = aggregate.lead.projectId;
    const account = await this.providers.crm.createAccount(
      { projectId: key, business: aggregate.business },
      `${key}:crm-account`,
    );
    const contact = await this.providers.crm.createContact(
      {
        projectId: key,
        accountId: account.id,
        business: aggregate.business,
        // A public listing number may belong to reception or an employee.
        // Do not invent an owner identity before the sales flow verifies a role.
        displayName: `${aggregate.business.name} Public Line`,
      },
      `${key}:crm-contact`,
    );
    const deal = await this.providers.crm.createDeal(
      {
        projectId: key,
        accountId: account.id,
        contactId: contact.id,
        title: key,
        amount: aggregate.campaign.pricingPolicy.basePrice,
        currency: aggregate.campaign.pricingPolicy.currency,
        stage: "Qualified",
      },
      `${key}:crm-deal`,
    );
    aggregate.lead.freshworksAccountId = account.id;
    aggregate.lead.freshworksContactId = contact.id;
    aggregate.lead.freshworksDealId = deal.id;
    this.#emit(aggregate, "CRM", "crm.records.created", "CRM account, contact and deal created.", "SUCCESS", {
      provider: this.providers.crm.name,
      providerMode: this.providers.crm.mode,
    });
    this.#transition(aggregate, "CRM_CREATED", "CRM", "CRM lifecycle records created.", `${key}:crm-created`);
    await this.repository.save(aggregate);
  }

  async #startConversation(aggregate: LeadAggregate): Promise<void> {
    const projectId = aggregate.lead.projectId;
    const session = await this.providers.conversation.createSession(
      { projectId, lead: aggregate.lead, business: aggregate.business, campaign: aggregate.campaign },
      `${projectId}:conversation`,
    );
    aggregate.conversation = {
      id: `conversation-${projectId}`,
      leadId: aggregate.lead.id,
      provider: this.providers.conversation.name,
      providerMode: session.mode,
      providerConversationId: session.id,
      clientToken: session.clientToken,
      providerUrl: session.providerUrl,
      status: session.mode === "REAL" ? "PENDING" : "ACTIVE",
      transcript: [],
      summary: null,
      sentiment: "UNKNOWN",
      startedAt: session.mode === "REAL" ? null : this.#now(),
      endedAt: null,
    };
    this.#emit(aggregate, "SALES", "conversation.started", session.mode === "REAL"
      ? "Realtime sales conversation is ready for explicit browser consent."
      : "Sales conversation started.", "INFO", {
      provider: this.providers.conversation.name,
      providerMode: session.mode,
    });
    this.#transition(
      aggregate,
      "CONVERSATION_ACTIVE",
      "SALES",
      "Conversation session is active.",
      `${projectId}:conversation-active`,
    );
    await this.repository.save(aggregate);
  }

  async #applyConversationOutcome(
    aggregate: LeadAggregate,
    outcome: ConversationOutcome,
    idempotencyKey = `${aggregate.lead.projectId}:requirements-collected`,
  ): Promise<void> {
    if (!aggregate.conversation) throw new Error("Conversation record is missing.");
    if (!outcome.requirements.approvedAt) throw new Error("Conversation requirements must be approved.");
    if (outcome.requirements.businessType !== aggregate.business.category) {
      throw new Error("Conversation requirements do not match the qualified business type.");
    }
    if (
      !Array.isArray(outcome.requirements.pages) ||
      outcome.requirements.pages.length === 0 ||
      outcome.requirements.pages.some((page) => typeof page !== "string" || page.trim().length === 0)
    ) {
      throw new Error("Conversation outcome must contain at least one valid page.");
    }
    if (
      outcome.acceptedAmount !== null &&
      (!Number.isInteger(outcome.acceptedAmount) || outcome.acceptedAmount <= 0)
    ) {
      throw new Error("Accepted amount must be a positive integer or null.");
    }
    aggregate.conversation.status = "COMPLETED";
    aggregate.conversation.transcript = clone(outcome.transcript);
    aggregate.conversation.summary = outcome.summary;
    aggregate.conversation.sentiment = outcome.sentiment;
    aggregate.conversation.endedAt = this.#now();
    aggregate.requirements = {
      ...clone(outcome.requirements),
      id: `requirements-${aggregate.lead.projectId}`,
      leadId: aggregate.lead.id,
    };
    this.#emit(
      aggregate,
      "SALES",
      "requirements.extracted",
      "Conversation converted into approved structured requirements.",
      "SUCCESS",
    );
    this.#transition(
      aggregate,
      "REQUIREMENTS_COLLECTED",
      "SALES",
      "Structured requirements were collected and approved.",
      idempotencyKey,
    );
    aggregate.deal = {
      id: `deal-${aggregate.lead.projectId}`,
      leadId: aggregate.lead.id,
      quotedAmount: 0,
      discount: 0,
      finalAmount: outcome.acceptedAmount ?? 0,
      currency: aggregate.campaign.pricingPolicy.currency,
      status: "DRAFT",
      acceptedAt: null,
      lostReason: outcome.acceptedAmount === null ? "Customer did not accept an offer." : null,
    };
    await this.repository.save(aggregate);
  }

  async #beginNegotiation(aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.requirements || !aggregate.deal) throw new Error("Approved requirements and deal are required.");
    const quote = calculateQuote({ features: aggregate.requirements.features }, aggregate.campaign.pricingPolicy);
    aggregate.deal.quotedAmount = quote.amount;
    aggregate.deal.status = "NEGOTIATING";
    const requested = aggregate.deal.finalAmount || quote.amount;
    const offer = getNegotiationOffer(quote.amount, requested, aggregate.campaign.pricingPolicy);
    aggregate.deal.finalAmount = offer.acceptedOffer;
    aggregate.deal.discount = offer.discount;
    if (aggregate.lead.freshworksDealId) {
      await this.providers.crm.updateDealStage(aggregate.lead.freshworksDealId, "Negotiating", quote.amount);
    }
    this.#emit(aggregate, "NEGOTIATION", "offer.calculated", `Approved offer ₹${offer.acceptedOffer.toLocaleString("en-IN")}.`, "INFO", {
      quote: quote.amount,
      floor: offer.floor,
      discount: offer.discount,
    });
    this.#transition(
      aggregate,
      "NEGOTIATING",
      "NEGOTIATION",
      "Quote calculated from server-side pricing policy.",
      `${aggregate.lead.projectId}:negotiating`,
    );
    await this.repository.save(aggregate);
  }

  async #closeNegotiation(aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.deal) throw new Error("Deal is missing.");
    const won = aggregate.deal.lostReason === null && aggregate.deal.finalAmount > 0;
    if (!won) {
      aggregate.deal.status = "LOST";
      this.#transition(
        aggregate,
        "DEAL_LOST",
        "NEGOTIATION",
        aggregate.deal.lostReason ?? "Offer declined.",
        `${aggregate.lead.projectId}:deal-lost`,
      );
      await this.repository.save(aggregate);
      return;
    }

    const revenueId = `revenue-${aggregate.lead.projectId}`;
    const existingRevenue = aggregate.revenueEvents.find((event) => event.id === revenueId);
    if (
      existingRevenue &&
      (existingRevenue.dealId !== aggregate.deal.id ||
        existingRevenue.amount !== aggregate.deal.finalAmount ||
        existingRevenue.currency !== aggregate.deal.currency ||
        existingRevenue.type !== "BOOKED")
    ) {
      throw new Error(`Revenue event ${revenueId} conflicts with the accepted deal.`);
    }

    // Complete provider synchronization before mutating the local commercial record. A retry after
    // a CRM failure therefore resumes from NEGOTIATING without a phantom won deal or booked revenue.
    if (aggregate.lead.freshworksDealId) {
      await this.providers.crm.updateDealStage(aggregate.lead.freshworksDealId, "Deal Won", aggregate.deal.finalAmount);
      await this.providers.crm.addNote(
        aggregate.lead.freshworksDealId,
        `AgentFront ${aggregate.lead.projectId}: offer accepted for ₹${aggregate.deal.finalAmount}.`,
      );
    }
    this.#transition(
      aggregate,
      "DEAL_WON",
      "NEGOTIATION",
      "Customer accepted an offer within the configured floor.",
      `${aggregate.lead.projectId}:deal-won`,
      { amount: aggregate.deal.finalAmount, currency: aggregate.deal.currency },
    );
    const acceptedAt = aggregate.deal.acceptedAt ?? this.#now();
    aggregate.deal.status = "WON";
    aggregate.deal.acceptedAt = acceptedAt;
    if (!existingRevenue) {
      aggregate.revenueEvents.push({
        id: revenueId,
        dealId: aggregate.deal.id,
        amount: aggregate.deal.finalAmount,
        currency: aggregate.deal.currency,
        type: "BOOKED",
        createdAt: acceptedAt,
      });
    }
    this.#emit(aggregate, "REVENUE", "deal.won", `Deal won for ₹${aggregate.deal.finalAmount.toLocaleString("en-IN")}.`, "SUCCESS");
    await this.repository.save(aggregate);
  }

  async #generateSpecification(aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.requirements || !aggregate.deal) throw new Error("Requirements and a won deal are required.");
    const specification = createProjectSpecification(
      aggregate.lead.projectId,
      aggregate.business,
      aggregate.requirements,
      aggregate.deal,
    );
    const now = this.#now();
    aggregate.project = {
      id: `project-${aggregate.lead.projectId}`,
      projectId: aggregate.lead.projectId,
      leadId: aggregate.lead.id,
      templateType: aggregate.business.category,
      specification,
      status: "SPEC_READY",
      buildPath: null,
      buildLog: [],
      qaStatus: "PENDING",
      qaResult: null,
      deploymentId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#emit(aggregate, "SPECIFICATION", "spec.generated", "Validated project_spec.json generated.", "SUCCESS");
    this.#transition(
      aggregate,
      "SPEC_GENERATED",
      "SPECIFICATION",
      "Approved commercial and product requirements became a project specification.",
      `${aggregate.lead.projectId}:spec-generated`,
    );
    await this.repository.save(aggregate);
  }

  async #build(aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.project?.specification) throw new Error("Validated project specification is missing.");
    aggregate.project.status = "BUILDING";
    this.#transition(
      aggregate,
      "BUILDING",
      "DEVELOPER",
      "Developer provider started in an isolated project workspace.",
      `${aggregate.lead.projectId}:building`,
    );
    this.#emit(aggregate, "DEVELOPER", "build.started", "Developer Agent started.", "INFO");
    await this.repository.save(aggregate);

    const providerEvents: AgentEvent[] = [];
    const result = await this.providers.developer.build(
      {
        project: aggregate.project,
        businessId: aggregate.business.id,
        specification: aggregate.project.specification,
        templateRoot: this.options.templateRoot,
        outputRoot: this.options.outputRoot,
      },
      (event) => providerEvents.push(event),
    );
    for (const event of providerEvents) {
      aggregate.events.push(event);
      this.events.publish(event);
    }
    aggregate.project.buildPath = result.buildPath;
    aggregate.project.buildLog.push(...result.logs);
    aggregate.project.updatedAt = this.#now();
    if (!result.success) throw new Error("Developer provider reported a failed production build.");
    this.#emit(aggregate, "DEVELOPER", "build.succeeded", "Production build passed.", "SUCCESS", {
      provider: this.providers.developer.name,
      providerMode: result.mode,
    });
    this.#transition(
      aggregate,
      "QA",
      "DEVELOPER",
      "Build completed and is ready for deterministic QA.",
      `${aggregate.lead.projectId}:qa`,
    );
    aggregate.project.status = "QA";
    await this.repository.save(aggregate);
  }

  async #qualityAssure(aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.project?.specification || !aggregate.requirements || !aggregate.project.buildPath) {
      throw new Error("Build artifacts required for QA are missing.");
    }
    const qa = runDeterministicQA({
      specification: aggregate.project.specification,
      requirements: aggregate.requirements,
      build: {
        buildPath: aggregate.project.buildPath,
        logs: aggregate.project.buildLog,
        success: true,
        mode: this.providers.developer.mode,
      },
    });
    aggregate.project.qaResult = qa;
    aggregate.project.qaStatus = qa.passed ? "PASSED" : "FAILED";
    if (!qa.passed) {
      const failures = qa.checks
        .filter((check) => check.blocking && !check.passed)
        .map((check) => `${check.name}: ${check.message}`)
        .join("; ");
      throw new Error(`Deterministic QA did not pass all blocking checks. ${failures}`);
    }
    this.#emit(aggregate, "QA", "qa.passed", `Deterministic QA passed with ${qa.score}/100.`, "SUCCESS", {
      score: qa.score,
    });
    this.#transition(
      aggregate,
      "DEPLOYING",
      "QA",
      "All blocking QA checks passed.",
      `${aggregate.lead.projectId}:deploying`,
    );
    aggregate.project.status = "DEPLOYING";
    await this.repository.save(aggregate);
  }

  async #deploy(aggregate: LeadAggregate): Promise<void> {
    if (!aggregate.project?.buildPath) throw new Error("A validated build path is required for deployment.");
    const deployment = await this.providers.deployment.deploy(
      { project: aggregate.project, buildPath: aggregate.project.buildPath },
      `${aggregate.lead.projectId}:deployment`,
    );
    aggregate.deployment = deployment;
    aggregate.project.deploymentId = deployment.id;
    aggregate.project.status = "DEPLOYED";
    this.#emit(aggregate, "DEPLOYMENT", "deployment.succeeded", `Site deployed to ${deployment.url}.`, "SUCCESS", {
      url: deployment.url,
      provider: this.providers.deployment.name,
      providerMode: deployment.providerMode,
    });
    this.#transition(
      aggregate,
      "DEPLOYED",
      "DEPLOYMENT",
      "Website deployed; CRM lifecycle synchronization follows as an independently retryable effect.",
      `${aggregate.lead.projectId}:deployed`,
      { url: deployment.url },
    );
    // Persist the remote deployment before attempting CRM synchronization. A
    // CRM outage must never relabel a live site DEPLOY_FAILED or trigger a
    // second provider deployment on retry.
    await this.repository.save(aggregate);
    await this.#synchronizeDeploymentCRM(aggregate);
  }

  async #synchronizeDeploymentCRM(aggregate: LeadAggregate): Promise<void> {
    const deployment = aggregate.deployment;
    if (!deployment) throw new Error("A deployed site is required for CRM synchronization.");
    if (!aggregate.lead.freshworksDealId) {
      this.#emit(
        aggregate,
        "CRM",
        "crm.deployment.synced",
        "Deployment is durable; no external CRM deal was configured for synchronization.",
        "SUCCESS",
      );
      await this.repository.save(aggregate);
      return;
    }
    try {
      await this.providers.crm.updateDealStage(
        aggregate.lead.freshworksDealId,
        "Deployed",
        aggregate.deal?.finalAmount,
      );
      await this.providers.crm.addNote(
        aggregate.lead.freshworksDealId,
        `Website deployed: ${deployment.url}`,
      );
      this.#emit(
        aggregate,
        "CRM",
        "crm.deployment.synced",
        "CRM lifecycle updated with the durable deployment.",
        "SUCCESS",
        { deploymentId: deployment.id },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown CRM synchronization failure.";
      this.#emit(
        aggregate,
        "CRM",
        "crm.deployment.sync_failed",
        `Website remains deployed; CRM synchronization requires retry: ${message}`,
        "ERROR",
        { deploymentId: deployment.id },
      );
    }
    await this.repository.save(aggregate);
  }

  async #campaignAllowsProgress(aggregate: LeadAggregate): Promise<boolean> {
    if (await this.options.shouldPause?.()) return false;
    const latestStatus = this.repository.getCampaignStatus
      ? await this.repository.getCampaignStatus(aggregate.lead.campaignId)
      : aggregate.campaign.status;
    if (latestStatus) aggregate.campaign.status = latestStatus;
    if (latestStatus === "RUNNING") return true;

    const status = latestStatus ?? "MISSING";
    const alreadyRecorded = aggregate.events.some((event) =>
      event.eventType === "pipeline.execution.blocked" &&
      event.metadata.campaignStatus === status &&
      event.metadata.blockedState === aggregate.lead.status,
    );
    if (!alreadyRecorded) {
      this.#emit(
        aggregate,
        "ORCHESTRATOR",
        "pipeline.execution.blocked",
        `Campaign is ${status}; pipeline execution is parked at ${aggregate.lead.status}.`,
        "WARNING",
        { campaignStatus: status, blockedState: aggregate.lead.status },
      );
      await this.repository.save(aggregate);
    }
    return false;
  }

  async #recordFailure(aggregate: LeadAggregate, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Unknown pipeline failure.";
    const current = aggregate.lead.status;
    let target: PipelineState | null = null;
    if (current === "BUILDING" || current === "QA") target = "BUILD_FAILED";
    if (current === "DEPLOYING") target = "DEPLOY_FAILED";
    this.#emit(aggregate, "ORCHESTRATOR", "pipeline.failed", message, "ERROR", { failedState: current });
    if (target) {
      this.#transition(
        aggregate,
        target,
        current === "DEPLOYING" ? "DEPLOYMENT" : "DEVELOPER",
        message,
        `${aggregate.lead.projectId}:${target.toLowerCase()}:${aggregate.lead.version}`,
      );
      if (aggregate.project) aggregate.project.status = "FAILED";
    }
    await this.repository.save(aggregate);
  }

  #transition(
    aggregate: LeadAggregate,
    targetState: PipelineState,
    actor: AgentType | "FOUNDER" | "SYSTEM",
    reason: string,
    idempotencyKey: string,
    metadata: Record<string, unknown> = {},
  ): void {
    const result = this.#stateMachine.transition(
      {
        leadId: aggregate.lead.id,
        projectId: aggregate.lead.projectId,
        currentState: aggregate.lead.status,
        targetState,
        actor,
        reason,
        idempotencyKey,
        metadata,
        at: this.#now(),
      },
      aggregate.transitions,
    );
    if (result.replayed) return;
    aggregate.transitions.push(result.transition);
    aggregate.lead.status = targetState;
    aggregate.lead.version += 1;
    aggregate.lead.updatedAt = result.transition.createdAt;
    this.#emit(
      aggregate,
      actor === "FOUNDER" || actor === "SYSTEM" ? "ORCHESTRATOR" : actor,
      "pipeline.transitioned",
      `${result.transition.from ?? "NEW"} → ${targetState}`,
      "INFO",
      { from: result.transition.from, to: targetState, reason },
    );
  }

  #emit(
    aggregate: LeadAggregate,
    agentType: AgentType,
    eventType: string,
    message: string,
    status: AgentEvent["status"],
    metadata: Record<string, unknown> = {},
  ): void {
    const event: AgentEvent = {
      id: `event-${aggregate.lead.projectId}-${aggregate.events.length + 1}`,
      leadId: aggregate.lead.id,
      projectId: aggregate.lead.projectId,
      campaignId: aggregate.lead.campaignId,
      agentType,
      eventType,
      message,
      metadata,
      status,
      durationMs: null,
      createdAt: this.#now(),
    };
    aggregate.events.push(event);
    this.events.publish(event);
  }

  #now(): string {
    return this.#clock().toISOString();
  }
}
