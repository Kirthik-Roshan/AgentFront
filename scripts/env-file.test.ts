import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("environment file bootstrap", () => {
  it("loads an optional root .env without overriding already-exported values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentfront-env-"));
    temporaryDirectories.push(directory);
    const environmentFile = join(directory, ".env");
    await writeFile(environmentFile, "AGENTFRONT_ENV_TEST=from-file\n", "utf8");

    const previous = process.env.AGENTFRONT_ENV_TEST;
    try {
      process.env.AGENTFRONT_ENV_TEST = "already-exported";
      loadEnvFile(environmentFile);
      expect(process.env.AGENTFRONT_ENV_TEST).toBe("already-exported");
    } finally {
      if (previous === undefined) delete process.env.AGENTFRONT_ENV_TEST;
      else process.env.AGENTFRONT_ENV_TEST = previous;
    }

    const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["dev:api"]).toContain("--env-file-if-exists=.env");
    expect(manifest.scripts["dev:worker"]).toContain("--env-file-if-exists=.env");
  });
});
