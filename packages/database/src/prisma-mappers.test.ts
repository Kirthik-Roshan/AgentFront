import { describe, expect, it } from "vitest";
import { demoBusinesses, demoCampaign } from "./demo-data";
import {
  mapPersistedLeadAggregate,
  type PersistedLeadAggregateRecord,
} from "./prisma-mappers";
import { persistenceFingerprint } from "./prisma-store";

const at = "2026-08-23T10:00:00.000Z";

function persistedAggregate(): PersistedLeadAggregateRecord {
  const business = demoBusinesses[0]!;
  return {
    id: "lead-AF-2026-000001",
    projectId: "AF-2026-000001",
    businessId: business.id,
    campaignId: demoCampaign.id,
    opportunityScore: 91,
    scoreBreakdown: [{ key: "website", label: "Website gap", points: 25, maximum: 25, reason: "No website." }],
    qualificationReason: "Qualified.",
    status: "DEPLOYED",
    freshworksAccountId: "account-1",
    freshworksContactId: "contact-1",
    freshworksDealId: "crm-deal-1",
    version: 14,
    createdAt: new Date(at),
    updatedAt: new Date("2026-08-23T10:14:00.000Z"),
    business: {
      ...business,
      latitude: { toString: () => String(business.latitude) },
      longitude: { toString: () => String(business.longitude) },
      rating: { toString: () => String(business.rating) },
      createdAt: new Date(business.createdAt),
    },
    campaign: {
      ...demoCampaign,
      createdAt: new Date(demoCampaign.createdAt),
      startedAt: new Date(demoCampaign.startedAt!),
      stoppedAt: null,
    },
    conversations: [{
      id: "conversation-AF-2026-000001",
      leadId: "lead-AF-2026-000001",
      provider: "Demo Conversation",
      providerMode: "DEMO",
      providerConversationId: "provider-conversation-1",
      clientToken: "short-lived-token",
      providerUrl: null,
      status: "COMPLETED",
      transcript: [{ id: "turn-1", speaker: "CUSTOMER", text: "Approved.", at }],
      summary: "Customer approved the scope.",
      sentiment: "POSITIVE",
      startedAt: new Date(at),
      endedAt: new Date("2026-08-23T10:05:00.000Z"),
    }],
    requirements: {
      id: "requirements-AF-2026-000001",
      leadId: "lead-AF-2026-000001",
      businessType: "restaurant",
      pages: ["Home", "Menu", "Contact"],
      features: { menu: true, whatsappOrdering: true },
      branding: { style: "warm", primaryColour: "#9a3412", mobileFirst: true },
      contentRequirements: ["Menu"],
      budget: { minimum: 6_000, maximum: 8_000, currency: "INR" },
      notes: ["Launch this week"],
      approvedAt: new Date("2026-08-23T10:05:00.000Z"),
    },
    deal: {
      id: "deal-AF-2026-000001",
      leadId: "lead-AF-2026-000001",
      quotedAmount: 7_999,
      discount: 799,
      finalAmount: 7_200,
      currency: "INR",
      status: "WON",
      acceptedAt: new Date("2026-08-23T10:08:00.000Z"),
      lostReason: null,
      revenueEvents: [{
        id: "revenue-AF-2026-000001",
        dealId: "deal-AF-2026-000001",
        amount: 7_200,
        currency: "INR",
        type: "BOOKED",
        createdAt: new Date("2026-08-23T10:08:00.000Z"),
      }],
    },
    project: {
      id: "project-AF-2026-000001",
      projectId: "AF-2026-000001",
      leadId: "lead-AF-2026-000001",
      templateType: "restaurant",
      specification: {
        schemaVersion: 1,
        projectId: "AF-2026-000001",
        business: { name: business.name, type: "restaurant", location: business.address, phone: business.phone },
        commercial: { quotedPrice: 7_999, finalPrice: 7_200, currency: "INR" },
        pages: ["Home", "Menu", "Contact"],
        features: { menu: true, whatsappOrdering: true },
        design: { style: "warm", primaryColour: "#9a3412", mobileFirst: true },
      },
      status: "DEPLOYED",
      buildPath: "/srv/generated-sites/AF-2026-000001",
      buildLog: ["Build completed."],
      qaStatus: "PASSED",
      qaResult: { score: 100, passed: true, checks: [] },
      createdAt: new Date("2026-08-23T10:09:00.000Z"),
      updatedAt: new Date("2026-08-23T10:14:00.000Z"),
      deployment: {
        id: "deployment-AF-2026-000001",
        projectId: "project-AF-2026-000001",
        provider: "Demo Deployment",
        providerMode: "DEMO",
        url: "https://af-2026-000001.demo.agentfront.local",
        status: "DEPLOYED",
        deployedAt: new Date("2026-08-23T10:14:00.000Z"),
      },
    },
    transitions: [{
      id: "transition-AF-2026-000001-1",
      leadId: "lead-AF-2026-000001",
      projectId: "AF-2026-000001",
      from: null,
      to: "DISCOVERED",
      actor: "FOUNDER",
      reason: "Enrolled.",
      idempotencyKey: "AF-2026-000001:start:discovered",
      metadata: { source: "test" },
      createdAt: new Date(at),
    }],
    agentEvents: [{
      id: "event-AF-2026-000001-1",
      leadId: "lead-AF-2026-000001",
      projectId: "AF-2026-000001",
      campaignId: demoCampaign.id,
      agentType: "DISCOVERY",
      eventType: "business.enrolled",
      message: "Business enrolled.",
      metadata: { durable: true },
      status: "INFO",
      durationMs: null,
      createdAt: new Date(at),
    }],
  };
}

describe("Prisma persistence mapping", () => {
  it("restores every nested workflow record from a persisted lead graph", () => {
    const aggregate = mapPersistedLeadAggregate(persistedAggregate());

    expect(aggregate.lead).toMatchObject({ projectId: "AF-2026-000001", status: "DEPLOYED", version: 14 });
    expect(aggregate.business).toMatchObject({ name: "SpiceRoute Kitchen", latitude: 12.8996, rating: 4.4 });
    expect(aggregate.campaign.pricingPolicy.basePrice).toBe(5_999);
    expect(aggregate.conversation).toMatchObject({ status: "COMPLETED", sentiment: "POSITIVE" });
    expect(aggregate.requirements?.features).toMatchObject({ menu: true, whatsappOrdering: true });
    expect(aggregate.deal).toMatchObject({ status: "WON", finalAmount: 7_200 });
    expect(aggregate.project).toMatchObject({
      status: "DEPLOYED",
      deploymentId: "deployment-AF-2026-000001",
    });
    expect(aggregate.deployment?.url).toContain("af-2026-000001");
    expect(aggregate.transitions).toHaveLength(1);
    expect(aggregate.events).toHaveLength(1);
    expect(aggregate.revenueEvents).toEqual([
      expect.objectContaining({ id: "revenue-AF-2026-000001", amount: 7_200, type: "BOOKED" }),
    ]);
    expect(aggregate.lead.createdAt).toBe(at);
  });

  it("creates stable fingerprints independent of object key order", () => {
    expect(persistenceFingerprint({ projectId: "AF-1", metadata: { b: 2, a: 1 } })).toBe(
      persistenceFingerprint({ metadata: { a: 1, b: 2 }, projectId: "AF-1" }),
    );
    expect(persistenceFingerprint({ state: "QUALIFIED" })).not.toBe(
      persistenceFingerprint({ state: "DEPLOYED" }),
    );
  });
});
