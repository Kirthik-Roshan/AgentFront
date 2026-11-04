import type { Business, Campaign } from "@agentfront/types";

const seededAt = "2026-08-23T08:00:00.000Z";

/** The only fake business retained for the controlled hackathon demonstration. */
export const demoBusinesses: Business[] = [{
  id: "business-spiceroute",
  externalPlaceId: "demo-place-spiceroute",
  name: "SpiceRoute Kitchen",
  category: "restaurant",
  address: "Sholinganallur, Chennai",
  city: "Chennai",
  latitude: 12.8996,
  longitude: 80.2279,
  phone: "+917339140080",
  rating: 4.4,
  reviewCount: 427,
  website: null,
  googleMapsUrl: "https://www.google.com/maps?q=12.8996,80.2279",
  socialLinks: {},
  digitalPresenceStatus: "NONE",
  onlineOrdering: null,
  reservationSystem: null,
  source: "DEMO",
  createdAt: seededAt,
}];

export const demoCampaign: Campaign = {
  id: "campaign-stage-1-demo",
  name: "AgentFront Stage 1 Demo",
  status: "RUNNING",
  businessTypes: ["restaurant", "salon", "garments", "mechanic", "clinic", "education", "realestate", "fitness", "bakery", "legal"],
  locations: ["Sholinganallur", "Velachery", "OMR"],
  qualificationPolicy: {
    minimumRating: 3.5,
    minimumReviewCount: 20,
    requireMissingOrPoorWebsite: true,
    requirePhone: true,
  },
  minimumOpportunityScore: 75,
  pricingPolicy: {
    basePrice: 5_999,
    minimumPrice: 5_999,
    maximumPrice: 11_999,
    maximumDiscountPercent: 10,
    currency: "INR",
    featurePrices: {
      menu: 500,
      gallery: 500,
      whatsappOrdering: 1_000,
      googleMaps: 0,
      reservations: 2_000,
      booking: 1_500,
      catalog: 1_000,
      testimonials: 0,
      emergencyContact: 0,
    },
  },
  maximumCallsPerDay: 25,
  callingWindow: { start: "10:00", end: "19:00", timezone: "Asia/Kolkata" },
  automaticProcessing: false,
  createdAt: seededAt,
  startedAt: seededAt,
  stoppedAt: null,
};
