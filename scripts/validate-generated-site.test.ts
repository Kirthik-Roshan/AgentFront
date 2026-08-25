import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateGeneratedSite } from "./validate-generated-site.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const canonicalSite = path.join(repositoryRoot, "generated-sites/AF-2026-000001");
const temporaryDirectories: string[] = [];

const copyCanonicalSite = async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentfront-site-validator-"));
  temporaryDirectories.push(temporaryRoot);
  const siteDirectory = path.join(temporaryRoot, "site");
  await cp(canonicalSite, siteDirectory, { recursive: true });
  return siteDirectory;
};

const check = (report: Awaited<ReturnType<typeof validateGeneratedSite>>, name: string) => (
  report.checks.find((item) => item.name === name)
);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("generated-site validator", () => {
  it("accepts the canonical generated project", async () => {
    const report = await validateGeneratedSite(canonicalSite);

    expect(report.score).toBe(100);
  });

  it("rejects unsafe configured URLs and scope drift", async () => {
    const siteDirectory = await copyCanonicalSite();
    const configPath = path.join(siteDirectory, "business.config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.business.mapsLink = "javascript:alert(document.domain)";
    config.features.reservations = true;
    await writeFile(configPath, JSON.stringify(config));

    const report = await validateGeneratedSite(siteDirectory);

    expect(check(report, "Configured URLs use safe protocols")?.passed).toBe(false);
    expect(check(report, "Spec/config feature scope matches")?.passed).toBe(false);
  });

  it("checks scripts and local references beyond the home page", async () => {
    const siteDirectory = await copyCanonicalSite();
    const contactPath = path.join(siteDirectory, "contact.html");
    const scriptPath = path.join(siteDirectory, "app.js");
    await writeFile(contactPath, `${await readFile(contactPath, "utf8")}\n<a href="missing-contact-file.pdf">Missing</a>\n`);
    await writeFile(scriptPath, `${await readFile(scriptPath, "utf8")}\nfunction broken( {\n`);

    const report = await validateGeneratedSite(siteDirectory);

    expect(check(report, "All HTML references resolve safely")?.passed).toBe(false);
    expect(check(report, "JavaScript parses")?.passed).toBe(false);
  });
});
