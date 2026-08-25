import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectSpecification, Requirements } from "@agentfront/types";
import { runDeterministicQA } from "./qa";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const specification: ProjectSpecification = {
  schemaVersion: 1,
  projectId: "AF-2026-000001",
  business: {
    name: "SpiceRoute Kitchen",
    type: "restaurant",
    location: "Sholinganallur, Chennai",
    phone: "+91 98400 12001",
  },
  commercial: { quotedPrice: 7_999, finalPrice: 7_200, currency: "INR" },
  pages: ["Home", "Contact"],
  features: { whatsappOrdering: true },
  design: { style: "premium restaurant", mobileFirst: true },
};

const requirements: Requirements = {
  id: "requirements-AF-2026-000001",
  leadId: "lead-AF-2026-000001",
  businessType: "restaurant",
  pages: ["Home", "Contact"],
  features: { whatsappOrdering: true },
  branding: { style: "premium restaurant", primaryColour: null, mobileFirst: true },
  contentRequirements: [],
  budget: { minimum: 7_200, maximum: 7_999, currency: "INR" },
  notes: [],
  approvedAt: "2026-08-23T00:00:00.000Z",
};

const runQA = (buildPath: string) => runDeterministicQA({
  specification,
  requirements,
  build: { buildPath, logs: [], success: true, mode: "DEMO" },
});

describe("artifact-aware deterministic QA", () => {
  it("rejects a provider-successful build with no website entry artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-empty-build-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "project_spec.json"), JSON.stringify(specification), "utf8");

    const result = await runQA(root);

    expect(result.passed).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "artifact-index", passed: false }));
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "artifact-document-structure", passed: false }));
  });

  it("rejects broken local references and passes once the referenced artifact exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-broken-build-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "project_spec.json"), JSON.stringify(specification), "utf8");
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main><h1>Home</h1><section id="contact"><a href="https://wa.me/919840012001">WhatsApp</a></section></main></body></html>',
      "utf8",
    );

    const broken = await runQA(root);
    expect(broken.passed).toBe(false);
    expect(broken.checks).toContainEqual(expect.objectContaining({ name: "artifact-local-references", passed: false }));

    await writeFile(join(root, "styles.css"), "body { margin: 0; }", "utf8");
    const repaired = await runQA(root);
    expect(repaired.passed).toBe(true);
  });

  it("blocks deployment when a generated JavaScript artifact does not parse", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentfront-malformed-script-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "project_spec.json"), JSON.stringify(specification), "utf8");
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><body><main><h1>Home</h1><section id="contact"><a href="https://wa.me/919840012001">WhatsApp</a></section><script src="app.js"></script></main></body></html>',
      "utf8",
    );
    await writeFile(join(root, "app.js"), "function broken(", "utf8");

    const result = await runQA(root);
    expect(result.passed).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({
      name: "artifact-javascript-syntax",
      passed: false,
      blocking: true,
    }));
  });
});
