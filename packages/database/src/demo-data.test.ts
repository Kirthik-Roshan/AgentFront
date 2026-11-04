import { describe, expect, it } from "vitest";
import { demoBusinesses } from "./demo-data";

describe("demo seed data", () => {
  it("contains only the explicitly labelled SpiceRoute demo", () => {
    expect(demoBusinesses).toHaveLength(1);
    expect(demoBusinesses[0]).toMatchObject({
      id: "business-spiceroute", name: "SpiceRoute Kitchen", category: "restaurant",
      city: "Chennai", phone: "+917339140080", source: "DEMO",
    });
  });
});
