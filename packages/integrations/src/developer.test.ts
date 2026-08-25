import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildRequest } from "@agentfront/types";
import { afterEach, describe, expect, it } from "vitest";
import { DemoDeveloperProvider } from "./developer";

const temporaryRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentfront-developer-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "templates", "restaurant"), { recursive: true });
  await writeFile(join(root, "templates", "restaurant", "index.html"), "<!doctype html><title>Template</title>\n", "utf8");
  await writeFile(
    join(root, "templates", "restaurant", "business.config.json"),
    `${JSON.stringify({ meta: {}, business: {}, hero: {}, features: {} }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

const makeRequest = (
  root: string,
  overrides: Partial<{
    businessId: string;
    businessName: string;
    leadId: string;
    projectRecordId: string;
  }> = {},
): BuildRequest => ({
  businessId: overrides.businessId ?? "business-spiceroute",
  project: {
    id: overrides.projectRecordId ?? "project-AF-2026-000001",
    projectId: "AF-2026-000001",
    leadId: overrides.leadId ?? "lead-AF-2026-000001",
    templateType: "restaurant",
    specification: null,
    status: "BUILDING",
    buildPath: null,
    buildLog: [],
    qaStatus: "PENDING",
    qaResult: null,
    deploymentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  specification: {
    schemaVersion: 1,
    projectId: "AF-2026-000001",
    business: {
      name: overrides.businessName ?? "SpiceRoute Kitchen",
      type: "restaurant",
      location: "OMR, Chennai",
      phone: "+91 98400 12001",
    },
    commercial: {
      quotedPrice: 9_999,
      finalPrice: 7_999,
      currency: "INR",
    },
    pages: ["Home", "Menu", "Contact"],
    features: { menu: true, whatsappOrdering: true, googleMaps: true },
    design: { style: "warm", mobileFirst: true },
  },
  templateRoot: join(root, "templates"),
  outputRoot: join(root, "output"),
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generated developer workspaces", () => {
  it("creates an immutable ownership manifest before returning a customized workspace", async () => {
    const root = await makeRoot();
    const result = await new DemoDeveloperProvider().build(makeRequest(root));
    const manifestPath = join(result.buildPath, ".agentfront-workspace-owner.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const configuration = JSON.parse(await readFile(join(result.buildPath, "business.config.json"), "utf8")) as {
      business: { name: string };
    };

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      project: { id: "project-AF-2026-000001", projectId: "AF-2026-000001" },
      leadId: "lead-AF-2026-000001",
      business: { id: "business-spiceroute", name: "SpiceRoute Kitchen", type: "restaurant" },
      templateType: "restaurant",
    });
    expect((await lstat(manifestPath)).mode & 0o777).toBe(0o400);
    expect(configuration.business.name).toBe("SpiceRoute Kitchen");
  });

  it("reuses a workspace only when every owner identity matches", async () => {
    const root = await makeRoot();
    const request = makeRequest(root);
    const first = await new DemoDeveloperProvider().build(request);
    await writeFile(join(first.buildPath, "customer-approved-copy.txt"), "keep this", "utf8");
    const second = await new DemoDeveloperProvider().build(request);

    expect(second.buildPath).toBe(first.buildPath);
    expect(await readFile(join(second.buildPath, "customer-approved-copy.txt"), "utf8")).toBe("keep this");
  });

  it("allocates a fresh collision-safe workspace when a restarted process sees another client's project ID", async () => {
    const root = await makeRoot();
    const first = await new DemoDeveloperProvider().build(makeRequest(root));
    const originalManifest = await readFile(join(first.buildPath, ".agentfront-workspace-owner.json"), "utf8");
    await writeFile(join(first.buildPath, "first-client-private.txt"), "private first-client content", "utf8");

    const secondRequest = makeRequest(root, {
      businessId: "business-another-client",
      businessName: "Another Client Kitchen",
    });
    const second = await new DemoDeveloperProvider().build(secondRequest);

    expect(second.buildPath).not.toBe(first.buildPath);
    expect(second.buildPath).toContain("AF-2026-000001--");
    await expect(readFile(join(second.buildPath, "first-client-private.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(first.buildPath, ".agentfront-workspace-owner.json"), "utf8")).toBe(originalManifest);
    const secondManifest = JSON.parse(
      await readFile(join(second.buildPath, ".agentfront-workspace-owner.json"), "utf8"),
    ) as { business: { id: string } };
    expect(secondManifest.business.id).toBe("business-another-client");
  });

  it("rejects a symlinked output root", async () => {
    const root = await makeRoot();
    const actualOutput = join(root, "actual-output");
    await mkdir(actualOutput);
    await symlink(actualOutput, join(root, "output"), "dir");

    await expect(new DemoDeveloperProvider().build(makeRequest(root))).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlink in the project workspace instead of following it", async () => {
    const root = await makeRoot();
    const output = join(root, "output");
    const external = join(root, "external-workspace");
    await Promise.all([mkdir(output), mkdir(external)]);
    await symlink(external, join(output, "AF-2026-000001"), "dir");

    await expect(new DemoDeveloperProvider().build(makeRequest(root))).rejects.toThrow(/symbolic link/i);
    await expect(readFile(join(external, "project_spec.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["project_spec.json", "business.config.json"])(
    "rejects a symlinked generated %s file without changing the link target",
    async (fileName) => {
      const root = await makeRoot();
      const request = makeRequest(root);
      const first = await new DemoDeveloperProvider().build(request);
      const external = join(root, `external-${fileName}`);
      await writeFile(external, "external content must survive", "utf8");
      await unlink(join(first.buildPath, fileName));
      await symlink(external, join(first.buildPath, fileName));

      await expect(new DemoDeveloperProvider().build(request)).rejects.toThrow(/symbolic link/i);
      expect(await readFile(external, "utf8")).toBe("external content must survive");
    },
  );

  it("rejects template symlinks without copying their external contents", async () => {
    const root = await makeRoot();
    const external = join(root, "outside-template.txt");
    await writeFile(external, "do not copy", "utf8");
    await symlink(external, join(root, "templates", "restaurant", "external.txt"));

    await expect(new DemoDeveloperProvider().build(makeRequest(root))).rejects.toThrow(/symbolic links/i);
    await expect(readFile(join(root, "output", "AF-2026-000001", "external.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects multiply-linked specification files before truncating external content", async () => {
    const root = await makeRoot();
    const request = makeRequest(root);
    const first = await new DemoDeveloperProvider().build(request);
    const external = join(root, "external-specification.json");
    await writeFile(external, "external content must survive", "utf8");
    await unlink(join(first.buildPath, "project_spec.json"));
    await link(external, join(first.buildPath, "project_spec.json"));

    await expect(new DemoDeveloperProvider().build(request)).rejects.toThrow(/regular, unlinked workspace file/i);
    expect(await readFile(external, "utf8")).toBe("external content must survive");
  });

  it("does not rewrite a corrupt ownership manifest", async () => {
    const root = await makeRoot();
    const first = await new DemoDeveloperProvider().build(makeRequest(root));
    const manifestPath = join(first.buildPath, ".agentfront-workspace-owner.json");
    await chmod(manifestPath, 0o600);
    await writeFile(manifestPath, "{\"schemaVersion\":1,\"corrupt\":true}\n", "utf8");
    await chmod(manifestPath, 0o400);

    const second = await new DemoDeveloperProvider().build(makeRequest(root));

    expect(second.buildPath).not.toBe(first.buildPath);
    expect(await readFile(manifestPath, "utf8")).toBe("{\"schemaVersion\":1,\"corrupt\":true}\n");
  });
});
