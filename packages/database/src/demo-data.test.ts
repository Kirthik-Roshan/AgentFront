import { describe, expect, it } from "vitest";
import { demoBusinesses } from "./demo-data";

describe("demo seed data", () => {
  it("contains at least eight clearly marked businesses per MVP vertical", () => {
    for (const category of ["restaurant", "salon", "garments", "mechanic"] as const) {
      expect(demoBusinesses.filter((business) => business.category === category)).toHaveLength(8);
    }
    expect(demoBusinesses[0]).toMatchObject({ name: "SpiceRoute Kitchen", source: "DEMO" });
  });
});
