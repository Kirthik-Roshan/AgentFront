import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeDeveloperProvider, createProviderSet } from "@agentfront/integrations";
import { AgentEventBus, AgentFrontOrchestrator } from "@agentfront/orchestration";
import type { SalesBusinessDetail } from "@agentfront/types";
import { demoBusinesses, demoCampaign } from "./demo-data";
import { InMemoryAgentFrontStore } from "./in-memory-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("canonical Stage-1 pipeline", () => {
  it("traces AF-2026-000001 from discovery to a deployed ₹7,200 project without duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-flow-"));
    temporaryDirectories.push(root);
    const store = new InMemoryAgentFrontStore();
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const orchestrator = new AgentFrontOrchestrator(store, providers, new AgentEventBus(), {
      templateRoot: join(process.cwd(), "templates"),
      outputRoot: join(root, "generated-sites"),
    });
    const business = store.getBusiness("business-spiceroute");
    expect(business).not.toBeNull();

    const [enrolled, duplicate] = await Promise.all([
      orchestrator.start({
        business: business!,
        campaign: demoCampaign,
        idempotencyKey: "stage-1-click",
      }),
      orchestrator.start({
        business: business!,
        campaign: demoCampaign,
        idempotencyKey: "second-click",
      }),
    ]);
    expect(enrolled.lead.projectId).toBe("AF-2026-000001");
    expect(duplicate.lead.id).toBe(enrolled.lead.id);

    const [completed, duplicateRun] = await Promise.all([
      orchestrator.run(enrolled.lead.id),
      orchestrator.run(enrolled.lead.id),
    ]);
    expect(completed.lead.status).toBe("DEPLOYED");
    expect(completed.lead.opportunityScore).toBe(91);
    expect(completed.deal).toMatchObject({ status: "WON", quotedAmount: 7_999, finalAmount: 7_200 });
    expect(completed.project?.specification?.projectId).toBe("AF-2026-000001");
    expect(completed.deployment?.url).toContain("af-2026-000001");
    expect(completed.revenueEvents).toHaveLength(1);
    expect(duplicateRun.transitions).toEqual(completed.transitions);
    expect(new Set(completed.transitions.map((transition) => transition.idempotencyKey)).size).toBe(
      completed.transitions.length,
    );
    const generatedConfig = JSON.parse(
      await readFile(join(root, "generated-sites", "AF-2026-000001", "business.config.json"), "utf8"),
    ) as { meta: { preview: boolean; projectId: string }; business: { name: string; phoneDisplay: string } };
    expect(generatedConfig).toMatchObject({
      meta: { preview: false, projectId: "AF-2026-000001" },
      business: { name: "SpiceRoute Kitchen", phoneDisplay: "+917339140080" },
    });
  });

  it("keeps the deal negotiable and books revenue once when CRM synchronization is retried", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-revenue-retry-"));
    temporaryDirectories.push(root);
    const store = new InMemoryAgentFrontStore();
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const originalAddNote = providers.crm.addNote.bind(providers.crm);
    let failFirstNote = true;
    providers.crm.addNote = async (dealId, note) => {
      if (failFirstNote) {
        failFirstNote = false;
        throw new Error("Temporary CRM note failure.");
      }
      await originalAddNote(dealId, note);
    };
    const orchestrator = new AgentFrontOrchestrator(store, providers, new AgentEventBus(), {
      templateRoot: join(process.cwd(), "templates"),
      outputRoot: join(root, "generated-sites"),
    });
    const business = store.getBusiness("business-spiceroute");
    expect(business).not.toBeNull();
    const enrolled = await orchestrator.start({
      business: business!,
      campaign: demoCampaign,
      idempotencyKey: "revenue-retry",
    });

    await expect(orchestrator.run(enrolled.lead.id)).rejects.toThrow("Temporary CRM note failure.");
    const afterFailure = await store.findByLeadId(enrolled.lead.id);
    expect(afterFailure?.lead.status).toBe("NEGOTIATING");
    expect(afterFailure?.deal?.status).toBe("NEGOTIATING");
    expect(afterFailure?.revenueEvents).toHaveLength(0);

    const completed = await orchestrator.run(enrolled.lead.id);
    expect(completed.lead.status).toBe("DEPLOYED");
    expect(completed.revenueEvents).toHaveLength(1);
    expect(completed.revenueEvents[0]).toMatchObject({
      id: "revenue-AF-2026-000001",
      amount: 7_200,
      type: "BOOKED",
    });
  });

  it("keeps a durable deployment when CRM synchronization fails and retries only the CRM effect", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-deployment-crm-retry-"));
    temporaryDirectories.push(root);
    const store = new InMemoryAgentFrontStore();
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const originalDeploy = providers.deployment.deploy.bind(providers.deployment);
    const originalUpdateDealStage = providers.crm.updateDealStage.bind(providers.crm);
    let deploymentCalls = 0;
    let failFirstDeploymentSync = true;
    providers.deployment.deploy = async (request, idempotencyKey) => {
      deploymentCalls += 1;
      return originalDeploy(request, idempotencyKey);
    };
    providers.crm.updateDealStage = async (dealId, stage, amount) => {
      if (stage === "Deployed" && failFirstDeploymentSync) {
        failFirstDeploymentSync = false;
        throw new Error("Temporary deployment CRM failure.");
      }
      return originalUpdateDealStage(dealId, stage, amount);
    };
    const orchestrator = new AgentFrontOrchestrator(store, providers, new AgentEventBus(), {
      templateRoot: join(process.cwd(), "templates"),
      outputRoot: join(root, "generated-sites"),
    });
    const business = store.getBusiness("business-spiceroute");
    expect(business).not.toBeNull();
    const enrolled = await orchestrator.start({
      business: business!,
      campaign: demoCampaign,
      idempotencyKey: "deployment-crm-retry",
    });

    const deployedWithPendingSync = await orchestrator.run(enrolled.lead.id);
    expect(deployedWithPendingSync.lead.status).toBe("DEPLOYED");
    expect(deployedWithPendingSync.deployment).not.toBeNull();
    expect(deployedWithPendingSync.events).toContainEqual(expect.objectContaining({
      eventType: "crm.deployment.sync_failed",
      status: "ERROR",
    }));
    expect(deploymentCalls).toBe(1);

    const synchronized = await orchestrator.run(enrolled.lead.id);
    expect(synchronized.lead.status).toBe("DEPLOYED");
    expect(synchronized.events).toContainEqual(expect.objectContaining({
      eventType: "crm.deployment.synced",
      status: "SUCCESS",
    }));
    expect(deploymentCalls).toBe(1);
  });

  it("parks an in-flight pipeline at the next safe boundary after emergency stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-emergency-stop-"));
    temporaryDirectories.push(root);
    const store = new InMemoryAgentFrontStore();
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const originalCreateAccount = providers.crm.createAccount.bind(providers.crm);
    providers.crm.createAccount = async (input, idempotencyKey) => {
      const account = await originalCreateAccount(input, idempotencyKey);
      store.updateCampaignStatus(demoCampaign.id, "STOPPED");
      return account;
    };
    const orchestrator = new AgentFrontOrchestrator(store, providers, new AgentEventBus(), {
      templateRoot: join(process.cwd(), "templates"),
      outputRoot: join(root, "generated-sites"),
    });
    const business = store.getBusiness("business-spiceroute");
    expect(business).not.toBeNull();
    const enrolled = await orchestrator.start({
      business: business!,
      campaign: demoCampaign,
      idempotencyKey: "emergency-stop",
    });

    const parked = await orchestrator.run(enrolled.lead.id);
    expect(parked.lead.status).toBe("CRM_CREATED");
    expect(parked.transitions.some((transition) => transition.to === "OUTREACH_READY")).toBe(false);
    expect(parked.events).toContainEqual(expect.objectContaining({
      eventType: "pipeline.execution.blocked",
      status: "WARNING",
      metadata: expect.objectContaining({ campaignStatus: "STOPPED", blockedState: "CRM_CREATED" }),
    }));

    store.updateCampaignStatus(demoCampaign.id, "RUNNING");
    const resumed = await orchestrator.run(enrolled.lead.id);
    expect(resumed.lead.status).toBe("DEPLOYED");
  });

  it("delivers a newer sales specification through Claude without overwriting an older deployment", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-sales-delivery-isolation-"));
    temporaryDirectories.push(root);
    const store = new InMemoryAgentFrontStore();
    const providers = createProviderSet({ DEMO_MODE: "true" }, demoBusinesses);
    const orchestrator = new AgentFrontOrchestrator(store, providers, new AgentEventBus(), {
      templateRoot: join(process.cwd(), "templates"),
      outputRoot: join(root, "generated-sites"),
    });
    const business = store.getBusiness("business-spiceroute");
    expect(business).not.toBeNull();

    const legacyEnrollment = await orchestrator.start({
      business: business!,
      campaign: demoCampaign,
      idempotencyKey: "legacy-spiceroute-deployment",
    });
    const legacyDeployment = await orchestrator.run(legacyEnrollment.lead.id);
    expect(legacyDeployment).toMatchObject({
      lead: { status: "DEPLOYED", projectId: "AF-2026-000001" },
      deployment: { status: "DEPLOYED" },
    });
    const legacySnapshot = structuredClone(legacyDeployment);

    let claudeCalls = 0;
    providers.developer = new ClaudeDeveloperProvider({
      apiKey: "anthropic-test-key",
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        claudeCalls += 1;
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        const request = JSON.parse(body.messages[0]!.content) as {
          project_spec: { projectId: string; clientBrief?: string[] };
          current_config: Record<string, unknown> & { hero?: Record<string, unknown> };
        };
        expect(request.project_spec.projectId).toBe("AF-2026-000002");
        expect(request.project_spec.clientBrief).toContain("Feature an approved family dinner package.");
        const configuration = {
          ...request.current_config,
          hero: {
            ...request.current_config.hero,
            title: "Family dining, shaped around your requirements",
          },
        };
        return new Response(JSON.stringify({
          content: [{
            type: "tool_use",
            name: "write_business_configuration",
            input: {
              configuration_json: JSON.stringify(configuration),
              summary: "Applied the approved SpiceRoute brief to the existing restaurant template.",
            },
          }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
    });

    const now = "2026-09-23T10:00:00.000Z";
    const salesDetail: SalesBusinessDetail = {
      business: {
        ...business!,
        businessCode: "AF-BIZ-000032",
        freshworksAccountId: "fresh-account-spiceroute",
        freshworksDealId: "fresh-deal-spiceroute",
        salesState: "SPEC_GENERATED",
        updatedAt: now,
      },
      contacts: [{
        id: "contact-spiceroute-owner",
        businessId: business!.id,
        freshworksContactId: "fresh-contact-spiceroute",
        name: "SpiceRoute Owner",
        phone: "+91 98400 99999",
        normalizedPhone: "+919840099999",
        roles: ["OWNER"],
        isDecisionMaker: true,
        preferredLanguage: "TAMIL",
        source: "OUTBOUND_CALL",
        verified: true,
        dedupeKey: "spiceroute-owner",
        createdAt: now,
        updatedAt: now,
      }],
      calls: [],
      memory: null,
      followUps: [],
      events: [],
      transitions: [],
      projectSpec: {
        id: "sales-spec-spiceroute-v2",
        businessId: business!.id,
        contactId: "contact-spiceroute-owner",
        version: 2,
        specification: {
          schemaVersion: 1,
          businessId: business!.id,
          business: { name: business!.name, category: "restaurant", city: business!.city,
            phone: "+914440002222" },
          contact: { id: "contact-spiceroute-owner", name: "SpiceRoute Owner", roles: ["OWNER"] },
          requirements: {
            pages: ["Home", "Menu", "Gallery", "Contact"],
            features: { menu: true, gallery: true, whatsappOrdering: true, googleMaps: true },
            notes: ["Feature an approved family dinner package."],
          },
          branding: { style: "premium traditional", primaryColour: "#b3471d" },
          commercial: { quotedPrice: 8_000, agreedPrice: 7_200, currency: "INR" },
        },
        status: "READY",
        idempotencyKey: "sales-spec-spiceroute-v2",
        createdAt: now,
        updatedAt: now,
      },
    };

    const handedOff = await orchestrator.handoffSalesSpecification(salesDetail, demoCampaign.id);
    expect(handedOff).toMatchObject({
      lead: { status: "SPEC_GENERATED", projectId: "AF-2026-000002" },
      campaign: { id: "sales-spec-sales-spec-spiceroute-v2" },
      deal: { status: "WON", finalAmount: 7_200 },
    });
    expect(handedOff.lead.id).not.toBe(legacyDeployment.lead.id);

    const delivered = await orchestrator.run(handedOff.lead.id);
    expect(claudeCalls).toBe(1);
    expect(delivered).toMatchObject({
      lead: { status: "DEPLOYED", projectId: "AF-2026-000002" },
      project: { status: "DEPLOYED" },
      deployment: { status: "DEPLOYED" },
    });
    expect(delivered.events).toContainEqual(expect.objectContaining({
      eventType: "build.succeeded",
      metadata: expect.objectContaining({ provider: "Claude Template Customizer", providerMode: "REAL" }),
    }));

    const persistedLegacy = await store.findByLeadId(legacyDeployment.lead.id);
    expect(persistedLegacy).toEqual(legacySnapshot);
    expect((await store.list()).map((aggregate) => aggregate.lead.id)).toEqual(
      expect.arrayContaining([legacyDeployment.lead.id, delivered.lead.id]),
    );
  });
});
