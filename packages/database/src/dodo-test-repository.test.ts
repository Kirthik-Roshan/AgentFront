import { describe, expect, it } from "vitest";
import type { DodoTestConfig } from "@agentfront/integrations";
import { assertDodoCheckoutEligibility, DodoPersistenceError } from "./dodo-test-repository";

const configuration: DodoTestConfig = {
  apiKey: "test-key",
  productId: "pdt_spiceroute_test",
  webhookSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
  businessId: "bus_spiceroute_test",
  expectedAmountMinor: 720_000,
  currency: "INR",
  returnUrl: "http://localhost:3000/#/demo",
  projectId: "AF-2026-000001",
};

const eligible = {
  projectStatus: "DEPLOYED",
  deploymentStatus: "DEPLOYED",
  deploymentMode: "REAL",
  deploymentUrl: "https://af-2026-000001.vercel.app",
  dealStatus: "WON",
  dealAcceptedAt: new Date("2026-09-21T10:00:00.000Z"),
  dealFinalAmount: 7_200,
  dealCurrency: "INR",
};

describe("Dodo test checkout eligibility", () => {
  it("accepts only the real deployed SpiceRoute deal at the exact agreed amount", () => {
    expect(() => assertDodoCheckoutEligibility(eligible, configuration)).not.toThrow();
  });

  it.each([
    ["demo deployment", { deploymentMode: "DEMO" }],
    ["unfinished deployment", { projectStatus: "QA" }],
    ["unaccepted deal", { dealAcceptedAt: null }],
  ])("rejects %s", (_label, patch) => {
    expect(() => assertDodoCheckoutEligibility({ ...eligible, ...patch }, configuration))
      .toThrowError(DodoPersistenceError);
  });

  it("rejects a checkout price that differs from the accepted deal", () => {
    expect(() => assertDodoCheckoutEligibility({ ...eligible, dealFinalAmount: 7_199 }, configuration))
      .toThrow(/does not match/);
  });
});
