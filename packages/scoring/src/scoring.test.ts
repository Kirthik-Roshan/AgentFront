import { describe, expect, it } from "vitest";
import type { Business, PricingPolicy } from "@agentfront/types";
import {
  calculateNegotiationFloor,
  calculateOpportunityScore,
  calculateQuote,
  getNegotiationOffer,
  validateProjectSpecification,
} from "./index";

const spiceRoute: Business = {
  id: "business-spiceroute",
  externalPlaceId: "demo-spiceroute",
  name: "SpiceRoute Kitchen",
  category: "restaurant",
  address: "Old Mahabalipuram Road, Sholinganallur",
  city: "Chennai",
  latitude: 12.8996,
  longitude: 80.2279,
  phone: "+91 98400 12001",
  rating: 4.4,
  reviewCount: 427,
  website: null,
  googleMapsUrl: "https://maps.google.com/?q=12.8996,80.2279",
  socialLinks: { instagram: "https://instagram.com/spiceroute" },
  digitalPresenceStatus: "NONE",
  onlineOrdering: null,
  reservationSystem: null,
  source: "DEMO",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const policy: PricingPolicy = {
  basePrice: 5_999,
  minimumPrice: 5_999,
  maximumPrice: 11_999,
  maximumDiscountPercent: 10,
  currency: "INR",
  featurePrices: { menu: 500, gallery: 500, whatsappOrdering: 1_000, googleMaps: 0 },
};

describe("opportunity scoring", () => {
  it("preserves the canonical SpiceRoute 91/100 score", () => {
    const score = calculateOpportunityScore(spiceRoute);
    expect(score.total).toBe(91);
    expect(score.qualified).toBe(true);
    expect(score.factors.map((factor) => factor.points)).toEqual([40, 20, 15, 16]);
  });
});

describe("pricing and negotiation", () => {
  it("calculates the canonical ₹7,999 quote and ₹7,200 floor", () => {
    const quote = calculateQuote(
      { features: { menu: true, gallery: true, whatsappOrdering: true, googleMaps: true } },
      policy,
    );
    expect(quote.amount).toBe(7_999);
    expect(calculateNegotiationFloor(quote.amount, policy)).toBe(7_200);
  });

  it("never accepts a requested offer below the configured floor", () => {
    expect(getNegotiationOffer(7_999, 6_000, policy)).toMatchObject({ acceptedOffer: 7_200, floor: 7_200 });
  });
});

describe("project specification schema", () => {
  it("rejects unapproved-shaped or unsafe specifications", () => {
    const result = validateProjectSpecification({ projectId: "bad", pages: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.length).toBeGreaterThan(2);
  });
});
