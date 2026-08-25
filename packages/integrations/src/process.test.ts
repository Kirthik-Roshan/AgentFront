import { describe, expect, it } from "vitest";
import { redactSensitiveOutput, runProcess } from "./process";

describe("restricted provider processes", () => {
  it("inherits only the base allowlist plus explicitly permitted provider variables", async () => {
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        "const fs=require('node:fs'); fs.writeSync(1, JSON.stringify([Boolean(process.env.DEPLOY_TOKEN), Boolean(process.env.FRESHWORKS_API_KEY), Boolean(process.env.PATH)])); fs.writeSync(2, 'DEPLOY_TOKEN='+process.env.DEPLOY_TOKEN)",
      ],
      {
        env: {
          ...process.env,
          DEPLOY_TOKEN: "deployment-secret-value",
          FRESHWORKS_API_KEY: "freshworks-secret-value",
        },
        allowedEnvKeys: ["DEPLOY_TOKEN"],
        redactValues: ["deployment-secret-value"],
        timeoutMs: 5_000,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([true, false, true]);
    expect(result.stderr).not.toContain("deployment-secret-value");
    expect(result.stderr).toContain("[REDACTED]");
  });

  it("redacts exact secrets, credential assignments and authorization headers", () => {
    const output = redactSensitiveOutput(
      [
        "DEPLOY_TOKEN=deployment-secret-value",
        '"FRESHWORKS_API_KEY":"freshworks-secret-value"',
        "Authorization: Bearer bearer-secret-value",
        "opaque-secret-value",
      ].join("\n"),
      ["opaque-secret-value"],
    );

    expect(output).not.toContain("deployment-secret-value");
    expect(output).not.toContain("freshworks-secret-value");
    expect(output).not.toContain("bearer-secret-value");
    expect(output).not.toContain("opaque-secret-value");
    expect(output).toContain("[REDACTED]");
  });

  it("waits for a timed-out child to terminate and escalates when SIGTERM is ignored", async () => {
    const started = Date.now();
    await expect(runProcess(process.execPath, [
      "-e",
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
    ], { timeoutMs: 40, terminationGraceMs: 40 })).rejects.toThrow(/timed out.*terminated/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
