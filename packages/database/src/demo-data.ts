import type { Business, BusinessType, Campaign } from "@agentfront/types";

const seededAt = "2026-08-23T08:00:00.000Z";

interface BusinessSeed {
  name: string;
  category: BusinessType;
  locality: string;
  rating: number;
  reviews: number;
  phone?: string;
  website?: string;
  instagram?: string;
  latitude: number;
  longitude: number;
}

const seeds: BusinessSeed[] = [
  { name: "SpiceRoute Kitchen", category: "restaurant", locality: "Sholinganallur", rating: 4.4, reviews: 427, phone: "+91 98400 12001", instagram: "spiceroute.kitchen", latitude: 12.8996, longitude: 80.2279 },
  { name: "Anjappar Claypot", category: "restaurant", locality: "Sholinganallur", rating: 4.2, reviews: 318, phone: "+91 98400 12002", latitude: 12.9014, longitude: 80.2292 },
  { name: "OMR Tiffin House", category: "restaurant", locality: "Sholinganallur", rating: 4.1, reviews: 186, phone: "+91 98400 12003", instagram: "omrtiffinhouse", latitude: 12.8978, longitude: 80.2258 },
  { name: "Madras Pepper Grill", category: "restaurant", locality: "Perumbakkam", rating: 4.5, reviews: 612, phone: "+91 98400 12004", website: "https://example.com/madras-pepper", latitude: 12.9051, longitude: 80.2138 },
  { name: "Coastal Curry Leaf", category: "restaurant", locality: "Navalur", rating: 4.0, reviews: 93, phone: "+91 98400 12005", latitude: 12.8447, longitude: 80.2264 },
  { name: "Velachery Millet Cafe", category: "restaurant", locality: "Velachery", rating: 4.3, reviews: 254, phone: "+91 98400 12006", instagram: "milletcafe", latitude: 12.9815, longitude: 80.218 },
  { name: "Bay Bowl Express", category: "restaurant", locality: "Thoraipakkam", rating: 3.9, reviews: 142, phone: "+91 98400 12007", latitude: 12.9416, longitude: 80.2362 },
  { name: "Namma Virundhu", category: "restaurant", locality: "Karapakkam", rating: 4.6, reviews: 1_104, phone: "+91 98400 12008", website: "https://example.com/namma-virundhu", latitude: 12.9152, longitude: 80.2298 },
  { name: "Aura Beauty Studio", category: "salon", locality: "Sholinganallur", rating: 4.5, reviews: 306, phone: "+91 98400 22001", instagram: "aurabeautystudio", latitude: 12.9003, longitude: 80.2246 },
  { name: "Blush & Bloom Salon", category: "salon", locality: "Sholinganallur", rating: 4.3, reviews: 221, phone: "+91 98400 22002", latitude: 12.903, longitude: 80.2281 },
  { name: "Studio Bloom", category: "salon", locality: "Navalur", rating: 4.1, reviews: 128, phone: "+91 98400 22003", latitude: 12.8455, longitude: 80.2281 },
  { name: "Malar Family Salon", category: "salon", locality: "Perumbakkam", rating: 4.0, reviews: 88, phone: "+91 98400 22004", latitude: 12.906, longitude: 80.2148 },
  { name: "The Grooming Room", category: "salon", locality: "Thoraipakkam", rating: 4.6, reviews: 519, phone: "+91 98400 22005", website: "https://example.com/grooming-room", latitude: 12.9391, longitude: 80.2341 },
  { name: "Velvet Scissors", category: "salon", locality: "Velachery", rating: 3.9, reviews: 76, phone: "+91 98400 22006", latitude: 12.9791, longitude: 80.2204 },
  { name: "Radiance Bridal Lounge", category: "salon", locality: "Karapakkam", rating: 4.4, reviews: 347, phone: "+91 98400 22007", instagram: "radiancebridal", latitude: 12.9143, longitude: 80.2311 },
  { name: "Naturals Corner", category: "salon", locality: "Medavakkam", rating: 4.2, reviews: 411, phone: "+91 98400 22008", website: "https://example.com/naturals-corner", latitude: 12.9171, longitude: 80.1927 },
  { name: "Chennai Cotton Collective", category: "garments", locality: "Sholinganallur", rating: 4.3, reviews: 284, phone: "+91 98400 32001", instagram: "chennaicotton", latitude: 12.9021, longitude: 80.2263 },
  { name: "Kaveri Silks", category: "garments", locality: "Sholinganallur", rating: 4.1, reviews: 178, phone: "+91 98400 32002", latitude: 12.8984, longitude: 80.2301 },
  { name: "OMR Fashion Street", category: "garments", locality: "Karapakkam", rating: 4.0, reviews: 111, phone: "+91 98400 32003", latitude: 12.9131, longitude: 80.2304 },
  { name: "Thread & Loom", category: "garments", locality: "Navalur", rating: 4.5, reviews: 492, phone: "+91 98400 32004", website: "https://example.com/thread-and-loom", latitude: 12.8472, longitude: 80.2275 },
  { name: "Varnam Boutique", category: "garments", locality: "Velachery", rating: 4.4, reviews: 237, phone: "+91 98400 32005", instagram: "varnamboutique", latitude: 12.9801, longitude: 80.2171 },
  { name: "Everyday Menswear", category: "garments", locality: "Thoraipakkam", rating: 3.8, reviews: 63, phone: "+91 98400 32006", latitude: 12.9424, longitude: 80.2352 },
  { name: "Little Loom Kids", category: "garments", locality: "Perumbakkam", rating: 4.2, reviews: 156, phone: "+91 98400 32007", latitude: 12.9071, longitude: 80.2151 },
  { name: "Sundari Saree House", category: "garments", locality: "Medavakkam", rating: 4.6, reviews: 718, phone: "+91 98400 32008", website: "https://example.com/sundari-sarees", latitude: 12.916, longitude: 80.1938 },
  { name: "OMR Motor Works", category: "mechanic", locality: "Sholinganallur", rating: 4.4, reviews: 376, phone: "+91 98400 42001", latitude: 12.8962, longitude: 80.2239 },
  { name: "Pitstop Auto Care", category: "mechanic", locality: "Sholinganallur", rating: 4.2, reviews: 265, phone: "+91 98400 42002", instagram: "pitstopautocare", latitude: 12.9041, longitude: 80.226 },
  { name: "Navalur Car Clinic", category: "mechanic", locality: "Navalur", rating: 4.1, reviews: 149, phone: "+91 98400 42003", latitude: 12.8437, longitude: 80.2249 },
  { name: "Torque Works", category: "mechanic", locality: "Thoraipakkam", rating: 4.5, reviews: 538, phone: "+91 98400 42004", latitude: 12.9401, longitude: 80.2327 },
  { name: "Sri Ganesh Two Wheeler Care", category: "mechanic", locality: "Perumbakkam", rating: 4.0, reviews: 102, phone: "+91 98400 42005", latitude: 12.9082, longitude: 80.2125 },
  { name: "Velachery Auto Doctor", category: "mechanic", locality: "Velachery", rating: 4.3, reviews: 323, phone: "+91 98400 42006", latitude: 12.9824, longitude: 80.2166 },
  { name: "Highway Diesel Garage", category: "mechanic", locality: "Karapakkam", rating: 3.9, reviews: 74, phone: "+91 98400 42007", latitude: 12.912, longitude: 80.2287 },
  { name: "Medavakkam Wheel Works", category: "mechanic", locality: "Medavakkam", rating: 4.6, reviews: 806, phone: "+91 98400 42008", website: "https://example.com/wheel-works", latitude: 12.919, longitude: 80.1944 },
];

export const demoBusinesses: Business[] = seeds.map((seed, index) => ({
  id: index === 0 ? "business-spiceroute" : `business-demo-${String(index + 1).padStart(2, "0")}`,
  externalPlaceId: `demo-place-${String(index + 1).padStart(2, "0")}`,
  name: seed.name,
  category: seed.category,
  address: `${index + 1}, ${seed.locality} Main Road, ${seed.locality}`,
  city: "Chennai",
  latitude: seed.latitude,
  longitude: seed.longitude,
  phone: seed.phone ?? null,
  rating: seed.rating,
  reviewCount: seed.reviews,
  website: seed.website ?? null,
  googleMapsUrl: `https://www.google.com/maps?q=${seed.latitude},${seed.longitude}`,
  socialLinks: seed.instagram
    ? { instagram: `https://instagram.com/${seed.instagram}` }
    : ({} as Record<string, string>),
  digitalPresenceStatus: seed.website ? "ADEQUATE" : "NONE",
  onlineOrdering: null,
  reservationSystem: null,
  source: "DEMO",
  createdAt: seededAt,
}));

export const demoCampaign: Campaign = {
  id: "campaign-stage-1-demo",
  name: "AgentFront Stage 1 Demo",
  status: "RUNNING",
  businessTypes: ["restaurant", "salon", "garments", "mechanic"],
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
