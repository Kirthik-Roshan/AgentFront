import type {
  Business,
  BusinessType,
  IntegrationHealth,
  PlacesProvider,
  PlacesSearchRequest,
  PlacesSearchResult,
} from "@agentfront/types";
import { requestJson } from "./http";

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-IN");

interface Coordinates {
  latitude: number;
  longitude: number;
}

const maximumGoogleCircleRadiusMetres = 50_000;
const earthRadiusMetres = 6_371_008.8;

const isCoordinates = (value: Partial<Coordinates> | null | undefined): value is Coordinates =>
  typeof value?.latitude === "number" &&
  Number.isFinite(value.latitude) &&
  value.latitude >= -90 &&
  value.latitude <= 90 &&
  typeof value.longitude === "number" &&
  Number.isFinite(value.longitude) &&
  value.longitude >= -180 &&
  value.longitude <= 180;

const validateRadius = (radiusMetres: number): number => {
  if (!Number.isFinite(radiusMetres) || radiusMetres < 0 || radiusMetres > maximumGoogleCircleRadiusMetres) {
    throw new RangeError(`Places radius must be between 0 and ${maximumGoogleCircleRadiusMetres} metres.`);
  }
  return radiusMetres;
};

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const distanceMetres = (left: Coordinates, right: Coordinates): number => {
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMetres * Math.asin(Math.sqrt(haversine));
};

interface DemoLocationCentre extends Coordinates {
  aliases: readonly string[];
}

// The demo market is intentionally limited to these seeded Chennai territories.
// More-specific localities come before the city-wide fallback.
const demoLocationCentres: readonly DemoLocationCentre[] = [
  { aliases: ["sholinganallur", "solinganallur"], latitude: 12.901, longitude: 80.2279 },
  { aliases: ["perumbakkam"], latitude: 12.9051, longitude: 80.2138 },
  { aliases: ["navalur"], latitude: 12.8447, longitude: 80.2264 },
  { aliases: ["velachery"], latitude: 12.9815, longitude: 80.218 },
  { aliases: ["thoraipakkam", "thuraipakkam"], latitude: 12.9416, longitude: 80.2362 },
  { aliases: ["karapakkam"], latitude: 12.9152, longitude: 80.2298 },
  { aliases: ["medavakkam"], latitude: 12.9171, longitude: 80.1927 },
  { aliases: ["old mahabalipuram road", "omr"], latitude: 12.901, longitude: 80.2279 },
  { aliases: ["chennai", "madras"], latitude: 13.0827, longitude: 80.2707 },
];

const normalizeLocationWords = (value: string): string =>
  normalize(value).replace(/[^a-z0-9]+/g, " ").trim();

const resolveDemoLocationCentre = (location: string): Coordinates | null => {
  const normalizedLocation = ` ${normalizeLocationWords(location)} `;
  const match = demoLocationCentres.find((candidate) =>
    candidate.aliases.some((alias) => normalizedLocation.includes(` ${alias} `)),
  );
  return match ? { latitude: match.latitude, longitude: match.longitude } : null;
};

export class DemoPlacesProvider implements PlacesProvider {
  readonly name = "AgentFront Demo Places";
  readonly mode = "DEMO" as const;

  constructor(private readonly businesses: readonly Business[]) {}

  async search(request: PlacesSearchRequest): Promise<PlacesSearchResult> {
    const radiusMetres = validateRadius(request.radiusMetres);
    const centre = resolveDemoLocationCentre(request.location);
    const locationTokens = normalizeLocationWords(request.location).split(" ").filter((token) => token.length > 2);
    const businesses = this.businesses.filter((business) => {
      const haystack = normalize(`${business.address} ${business.city}`);
      const businessCoordinates = { latitude: business.latitude, longitude: business.longitude };
      // Keep token matching as a fallback for custom demo datasets outside the
      // known Chennai market, where no honest geographic centre is available.
      const isLocation = centre
        ? isCoordinates(businessCoordinates) && distanceMetres(centre, businessCoordinates) <= radiusMetres
        : locationTokens.every((token) => haystack.includes(token));
      const websiteMatch =
        !request.websitePresence ||
        request.websitePresence === "ANY" ||
        (request.websitePresence === "MISSING" ? !business.website : Boolean(business.website));
      return (
        isLocation &&
        business.category === request.businessType &&
        websiteMatch &&
        business.rating >= (request.minimumRating ?? 0) &&
        business.reviewCount >= (request.minimumReviewCount ?? 0)
      );
    });
    return { businesses: structuredClone(businesses), mode: this.mode, attribution: "DEMO DATA" };
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "places",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: `${this.businesses.length} clearly labelled local demo records loaded.`,
      checkedAt: new Date().toISOString(),
    };
  }
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  photos?: Array<{
    name?: string;
    authorAttributions?: Array<{ displayName?: string; uri?: string }>;
  }>;
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
}

interface GoogleGeocodingResponse {
  status?: string;
  results?: Array<{
    geometry?: {
      location?: { lat?: number; lng?: number };
    };
  }>;
}

const searchLabel: Record<BusinessType, string> = {
  restaurant: "restaurants",
  salon: "beauty salons",
  garments: "garment and clothing shops",
  mechanic: "automobile mechanic workshops",
  clinic: "clinics and medical centres",
  education: "coaching centres and training academies",
  realestate: "real estate agencies",
  fitness: "gyms and fitness studios",
  bakery: "bakeries and cake shops",
  legal: "law firms and legal services",
  spa: "spa services",
  dental: "dental services",
  physiotherapy: "physiotherapy services",
  petcare: "petcare services",
  catering: "catering services",
  events: "events services",
  photography: "photography services",
  interiors: "interiors services",
  travel: "travel services",
  movers: "movers services",
  appliance: "appliance services",
  trades: "trades services",
  detailing: "detailing services",
  drivingschool: "drivingschool services",
  laundry: "laundry services",
  furniture: "furniture services",
  devicerepair: "devicerepair services",
  printing: "printing services",
  florist: "florist services",
  jewellery: "jewellery services",
  tailoring: "tailoring services",
  cloudkitchen: "cloudkitchen services",
};

export class GooglePlacesProvider implements PlacesProvider {
  readonly name = "Google Places";
  readonly mode = "REAL" as const;
  #lastHealth: IntegrationHealth;

  constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error("Google Places API key is required.");
    this.#lastHealth = {
      integration: "places",
      provider: this.name,
      mode: this.mode,
      status: "DEGRADED",
      message: "Google Places credentials are configured but have not yet been verified by a successful search.",
      checkedAt: new Date().toISOString(),
    };
  }

  async search(request: PlacesSearchRequest): Promise<PlacesSearchResult> {
    try {
      const radiusMetres = validateRadius(request.radiusMetres);
      const centre = await this.geocode(request.location);
      const response = await requestJson<GooglePlacesResponse>(
        this.name,
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.photos",
          },
          body: JSON.stringify({
            // An explicit location in textQuery can override locationBias. Geocode
            // it first and keep this query categorical so the circle remains active.
            textQuery: request.searchQuery?.trim() || searchLabel[request.businessType],
            pageSize: 20,
            // Text Search (New) supports circles for locationBias; its stricter
            // locationRestriction field supports rectangles only.
            locationBias: {
              circle: {
                center: centre,
                radius: radiusMetres,
              },
            },
          }),
        },
      );

      const now = new Date().toISOString();
      const businesses = (response.places ?? [])
      // A circle is a bias, not a server-side guarantee. Apply the same exact
      // distance boundary as demo mode so radiusMetres has stable semantics.
      .filter((place) => isCoordinates(place.location) && distanceMetres(centre, place.location) <= radiusMetres)
      .map<Business>((place) => ({
        id: `google-${place.id}`,
        externalPlaceId: place.id,
        name: place.displayName?.text ?? "Unnamed business",
        category: request.businessType,
        address: place.formattedAddress ?? request.location,
        city: request.location,
        latitude: place.location?.latitude ?? 0,
        longitude: place.location?.longitude ?? 0,
        phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
        rating: place.rating ?? 0,
        reviewCount: place.userRatingCount ?? 0,
        website: place.websiteUri ?? null,
        googleMapsUrl: place.googleMapsUri ?? null,
        photoName: place.photos?.[0]?.name ?? null,
        photoAttribution: place.photos?.[0]?.authorAttributions?.[0]?.displayName
          ? {
              displayName: place.photos[0].authorAttributions[0].displayName,
              uri: place.photos[0].authorAttributions[0].uri ?? null,
            }
          : null,
        socialLinks: request.verticalId ? { agentfrontVertical: request.verticalId } : Object.create(null) as Record<string, string>,
        digitalPresenceStatus: place.websiteUri ? "ADEQUATE" : "NONE",
        onlineOrdering: null,
        reservationSystem: null,
        source: "GOOGLE_PLACES",
        createdAt: now,
      }));
      const filtered = businesses.filter((business) => {
        if (request.websitePresence === "MISSING" && business.website) return false;
        if (request.websitePresence === "PRESENT" && !business.website) return false;
        return (
          business.rating >= (request.minimumRating ?? 0) &&
          business.reviewCount >= (request.minimumReviewCount ?? 0)
        );
      });
      this.#lastHealth = {
        integration: "places",
        provider: this.name,
        mode: this.mode,
        status: "CONNECTED",
        message: "Google Places credentials were verified by a successful server-side search.",
        checkedAt: now,
      };
      return { businesses: filtered, mode: this.mode, attribution: "Google Places" };
    } catch (error) {
      this.#lastHealth = {
        integration: "places",
        provider: this.name,
        mode: this.mode,
        status: "DEGRADED",
        message: "Google Places credentials are configured, but the most recent search failed.",
        checkedAt: new Date().toISOString(),
      };
      throw error;
    }
  }

  async getPhotoUri(photoName: string, maximumWidth: number): Promise<string> {
    if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) {
      throw new Error("Google Places returned an invalid photo resource name.");
    }
    const width = Math.min(1600, Math.max(120, Math.round(maximumWidth)));
    const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
    url.searchParams.set("maxWidthPx", String(width));
    url.searchParams.set("skipHttpRedirect", "true");
    const result = await requestJson<{ photoUri?: string }>(this.name, url.toString(), {
      method: "GET",
      headers: { "X-Goog-Api-Key": this.apiKey },
    });
    if (!result.photoUri) throw new Error("Google Places did not return a photo URL.");
    const photoUrl = new URL(result.photoUri);
    if (photoUrl.protocol !== "https:") throw new Error("Google Places returned an unsafe photo URL.");
    return photoUrl.href;
  }

  async getBusinessPhotoUri(externalPlaceId: string, maximumWidth: number): Promise<string> {
    if (!/^[A-Za-z0-9_-]+$/.test(externalPlaceId)) {
      throw new Error("Invalid Google Places business identifier.");
    }
    const place = await requestJson<{ photos?: GooglePlace["photos"] }>(
      this.name,
      `https://places.googleapis.com/v1/places/${encodeURIComponent(externalPlaceId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "photos",
        },
      },
    );
    const photoName = place.photos?.[0]?.name;
    if (!photoName) throw new Error("Google Places did not return a photo for this business.");
    return this.getPhotoUri(photoName, maximumWidth);
  }

  private async geocode(location: string): Promise<Coordinates> {
    // Use Google's official Geocoding endpoint; never scrape Search or Maps HTML.
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", location);
    url.searchParams.set("key", this.apiKey);
    const response = await requestJson<GoogleGeocodingResponse>(this.name, url.toString(), { method: "GET" });
    const firstLocation = response.results?.[0]?.geometry?.location;
    const centre = firstLocation ? { latitude: firstLocation.lat, longitude: firstLocation.lng } : null;
    if (response.status !== "OK" || !isCoordinates(centre)) {
      throw new Error(`Google Geocoding could not resolve the requested location (${response.status ?? "UNKNOWN"}).`);
    }
    return centre;
  }

  async health(): Promise<IntegrationHealth> {
    return structuredClone(this.#lastHealth);
  }
}
