import { afterEach, describe, expect, it, vi } from "vitest";
import type { Business, CRMAccountInput, CRMContactInput, CRMDealInput } from "@agentfront/types";
import { DemoCRMProvider, FreshworksCRMProvider, mapBusinessToFreshworksAccount, mapBusinessToFreshworksContact, mapDealToFreshworks } from "./crm";

const business: Business = {
  id: "business-spiceroute",
  externalPlaceId: null,
  name: "SpiceRoute Kitchen",
  category: "restaurant",
  address: "OMR, Sholinganallur",
  city: "Chennai",
  latitude: 12.8996,
  longitude: 80.2279,
  phone: "+91 98400 12001",
  rating: 4.4,
  reviewCount: 427,
  website: null,
  googleMapsUrl: null,
  socialLinks: {},
  digitalPresenceStatus: "NONE",
  onlineOrdering: null,
  reservationSystem: null,
  source: "DEMO",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Freshworks mappings", () => {
  it("maps account, contact and canonical project ID without leaking provider concerns into domain data", () => {
    const accountInput: CRMAccountInput = { projectId: "AF-2026-000001", business };
    const contactInput: CRMContactInput = {
      projectId: "AF-2026-000001",
      accountId: "42",
      business,
      displayName: "Restaurant Owner",
      contactEmail: "owner@example.com",
    };
    const dealInput: CRMDealInput = {
      projectId: "AF-2026-000001",
      accountId: "42",
      contactId: "43",
      title: business.name,
      amount: 7_999,
      currency: "INR",
      stage: "Qualified",
    };
    expect(mapBusinessToFreshworksAccount(accountInput)).toMatchObject({ sales_account: { name: business.name } });
    expect(mapBusinessToFreshworksContact(contactInput)).toMatchObject({ contact: { last_name: "Owner", email: "owner@example.com" } });
    expect(mapBusinessToFreshworksContact({ ...contactInput, contactPhone: "+919876543210" }))
      .toMatchObject({ contact: { mobile_number: "+919876543210" } });
    expect(mapBusinessToFreshworksContact({ ...contactInput, displayName: "Raj" }))
      .toMatchObject({ contact: { first_name: "Raj" } });
    expect((mapBusinessToFreshworksContact({ ...contactInput, displayName: "Raj" }).contact as Record<string, unknown>))
      .not.toHaveProperty("last_name");
    expect(mapDealToFreshworks(dealInput)).toMatchObject({ deal: { name: expect.stringContaining("AF-2026-000001") } });
  });
});

describe("provider idempotency", () => {
  it("returns the same demo CRM deal for duplicate create attempts", async () => {
    const provider = new DemoCRMProvider();
    const input: CRMDealInput = {
      projectId: "AF-2026-000001",
      accountId: "account",
      contactId: "contact",
      title: business.name,
      amount: 7_999,
      currency: "INR",
      stage: "Qualified",
    };
    const first = await provider.createDeal(input, "same-key");
    const second = await provider.createDeal(input, "same-key");
    expect(second.id).toBe(first.id);
    expect(second.amount).toBe(7_999);
  });
});

describe("Freshworks CRM board projection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the default deal view and maps external deal fields for the operator board", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("selector/deal_stages")) {
        return new Response(JSON.stringify({ deal_stages: [{ id: 6, name: "Negotiating" }] }), { status: 200 });
      }
      if (url.includes("deals/filters")) {
        return new Response(JSON.stringify({ filters: [{ id: 4, is_default: true }] }), { status: 200 });
      }
      if (url.includes("deals/view/4")) {
        return new Response(JSON.stringify({ deals: [{
          id: 21,
          name: "AF-2026-000001 · SpiceRoute Kitchen",
          amount: "7200.0",
          deal_stage_id: 6,
          sales_account: { name: "SpiceRoute Kitchen" },
          updated_at: "2026-08-24T10:00:00.000Z",
        }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));

    const provider = new FreshworksCRMProvider({ domain: "demo.myfreshworks.com/crm/sales", apiKey: "test-key" });
    await expect(provider.listDeals()).resolves.toEqual([expect.objectContaining({
      id: "21",
      stage: "negotiating",
      amount: 7200,
      accountName: "SpiceRoute Kitchen",
      url: "https://demo.myfreshworks.com/crm/sales/deals/21",
    })]);
    expect(provider.getConsoleUrl()).toBe("https://demo.myfreshworks.com/crm/sales");
  });
});
