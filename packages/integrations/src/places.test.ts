import { afterEach, describe, expect, it, vi } from "vitest";
import type { Business, PlacesSearchRequest } from "@agentfront/types";
import { DemoPlacesProvider, GooglePlacesProvider } from "./places";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const demoBusiness = (
  id: string,
  latitude: number,
  longitude: number,
  overrides: Partial<Business> = {},
): Business => ({
  id,
  externalPlaceId: `demo-${id}`,
  name: id,
  category: "restaurant",
  address: `${id} Road, Chennai`,
  city: "Chennai",
  latitude,
  longitude,
  phone: null,
  rating: 4,
  reviewCount: 100,
  website: null,
  googleMapsUrl: null,
  socialLinks: {},
  digitalPresenceStatus: "NONE",
  onlineOrdering: null,
  reservationSystem: null,
  source: "DEMO",
  createdAt: "2026-08-23T08:00:00.000Z",
  ...overrides,
});

const searchRequest = (overrides: Partial<PlacesSearchRequest> = {}): PlacesSearchRequest => ({
  location: "Sholinganallur, Chennai",
  businessType: "restaurant",
  radiusMetres: 2_000,
  websitePresence: "ANY",
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GooglePlacesProvider", () => {
  it("geocodes with the configured key and sends a supported Text Search New circle request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          results: [{ geometry: { location: { lat: 12.901, lng: 80.2279 } } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          places: [
            {
              id: "inside",
              displayName: { text: "Inside Restaurant" },
              formattedAddress: "Sholinganallur, Chennai",
              location: { latitude: 12.902, longitude: 80.2279 },
              rating: 4.5,
              userRatingCount: 250,
            },
            {
              id: "outside",
              displayName: { text: "Outside Restaurant" },
              formattedAddress: "Outside the requested radius",
              location: { latitude: 12.95, longitude: 80.2279 },
              rating: 4.8,
              userRatingCount: 500,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GooglePlacesProvider("configured-google-key");
    await expect(provider.health()).resolves.toMatchObject({
      status: "DEGRADED",
      message: expect.stringContaining("not yet been verified"),
    });
    const result = await provider.search(searchRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const geocodeUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${geocodeUrl.origin}${geocodeUrl.pathname}`).toBe(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );
    expect(geocodeUrl.searchParams.get("address")).toBe("Sholinganallur, Chennai");
    expect(geocodeUrl.searchParams.get("key")).toBe("configured-google-key");

    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://places.googleapis.com/v1/places:searchText");
    const placesInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(placesInit).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "X-Goog-Api-Key": "configured-google-key",
      }),
    });
    const placesBody = JSON.parse(String(placesInit.body)) as Record<string, unknown>;
    expect(placesBody).toEqual({
      textQuery: "restaurants",
      pageSize: 20,
      locationBias: {
        circle: {
          center: { latitude: 12.901, longitude: 80.2279 },
          radius: 2_000,
        },
      },
    });
    expect(placesBody).not.toHaveProperty("locationRestriction");
    expect(result).toMatchObject({
      mode: "REAL",
      attribution: "Google Places",
      businesses: [{ id: "google-inside", externalPlaceId: "inside" }],
    });
    await expect(provider.health()).resolves.toMatchObject({
      status: "CONNECTED",
      message: expect.stringContaining("successful server-side search"),
    });
  });

  it("rejects unsupported radii before making a Google request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GooglePlacesProvider("configured-google-key");
    await expect(provider.search(searchRequest({ radiusMetres: 50_001 })))
      .rejects.toThrow("Places radius must be between 0 and 50000 metres.");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(provider.health()).resolves.toMatchObject({ status: "DEGRADED" });
  });
});

describe("DemoPlacesProvider", () => {
  it("centres known Chennai localities and Haversine-filters by the requested radius", async () => {
    const provider = new DemoPlacesProvider([
      demoBusiness("at-centre", 12.901, 80.2279),
      demoBusiness("nearby", 12.91, 80.2279),
      demoBusiness("far-away", 12.95, 80.2279),
      demoBusiness("wrong-category", 12.901, 80.2279, { category: "salon" }),
    ]);

    const narrow = await provider.search(searchRequest({ radiusMetres: 2_000 }));
    const wide = await provider.search(searchRequest({ radiusMetres: 6_000 }));

    expect(narrow.businesses.map((business) => business.id)).toEqual(["at-centre", "nearby"]);
    expect(wide.businesses.map((business) => business.id)).toEqual(["at-centre", "nearby", "far-away"]);
    expect(narrow).toMatchObject({ mode: "DEMO", attribution: "DEMO DATA" });
  });

  it("keeps address-token fallback behavior for custom demo locations", async () => {
    const provider = new DemoPlacesProvider([
      demoBusiness("custom-match", 0, 0, { address: "1 Custom Town High Street", city: "Elsewhere" }),
      demoBusiness("custom-miss", 0, 0, { address: "1 Different Town High Street", city: "Elsewhere" }),
    ]);

    const result = await provider.search(searchRequest({ location: "Custom Town" }));

    expect(result.businesses.map((business) => business.id)).toEqual(["custom-match"]);
  });
});
