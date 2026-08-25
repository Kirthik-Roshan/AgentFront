import { stat } from "node:fs/promises";
import type {
  Deployment,
  DeploymentProvider,
  DeploymentRequest,
  IntegrationHealth,
} from "@agentfront/types";
import { createRestrictedProcessEnvironment, runProcess } from "./process";

export class DemoDeploymentProvider implements DeploymentProvider {
  readonly name = "AgentFront Demo Deployment";
  readonly mode = "DEMO" as const;
  readonly #byKey = new Map<string, Deployment>();
  readonly #byId = new Map<string, Deployment>();

  async deploy(request: DeploymentRequest, idempotencyKey: string): Promise<Deployment> {
    const replay = this.#byKey.get(idempotencyKey);
    if (replay) return structuredClone(replay);
    const exists = await stat(request.buildPath).then((item) => item.isDirectory()).catch(() => false);
    if (!exists) throw new Error("Demo deployment requires an existing build directory.");
    const slug = request.project.projectId.toLowerCase();
    const deployment: Deployment = {
      id: `demo-deployment-${request.project.projectId}`,
      projectId: request.project.id,
      provider: this.name,
      providerMode: this.mode,
      url: `https://${slug}.demo.agentfront.local`,
      status: "DEPLOYED",
      deployedAt: new Date().toISOString(),
    };
    this.#byKey.set(idempotencyKey, deployment);
    this.#byId.set(deployment.id, deployment);
    return structuredClone(deployment);
  }

  async getStatus(deploymentId: string): Promise<Deployment | null> {
    const deployment = this.#byId.get(deploymentId);
    return deployment ? structuredClone(deployment) : null;
  }

  async health(): Promise<IntegrationHealth> {
    return {
      integration: "deployment",
      provider: this.name,
      mode: this.mode,
      status: "DEMO",
      message: "Clearly labelled mock deployment URLs will be generated.",
      checkedAt: new Date().toISOString(),
    };
  }
}

export class VercelCLIProvider implements DeploymentProvider {
  readonly name = "Vercel";
  readonly mode = "REAL" as const;
  readonly #byKey = new Map<string, Deployment>();
  readonly #byId = new Map<string, Deployment>();

  constructor(
    private readonly token: string,
    private readonly executable = "vercel",
  ) {
    if (!token.trim()) throw new Error("Vercel deployment token is required.");
  }

  async deploy(request: DeploymentRequest, idempotencyKey: string): Promise<Deployment> {
    const replay = this.#byKey.get(idempotencyKey);
    if (replay) return structuredClone(replay);
    const environment = createRestrictedProcessEnvironment();
    environment.VERCEL_TOKEN = this.token;
    environment.NO_COLOR = "1";
    // Vercel derives the project name from the working-directory basename when
    // --name is omitted. AgentFront project IDs intentionally use uppercase
    // `AF-...`, so pass a provider-safe lowercase name explicitly.
    const vercelProjectName = request.project.projectId.toLowerCase();
    const result = await runProcess(this.executable, ["deploy", "--prod", "--yes", "--no-color", "--name", vercelProjectName], {
      cwd: request.buildPath,
      env: environment,
      allowedEnvKeys: ["VERCEL_TOKEN"],
      redactValues: [this.token],
      timeoutMs: 10 * 60_000,
    });
    if (result.exitCode !== 0) throw new Error(`Vercel deployment failed: ${result.stderr.slice(-2_000)}`);
    const urls = result.stdout.trim().split(/\s+/).filter((value) => /^https?:\/\//.test(value));
    const url = urls[urls.length - 1];
    if (!url) throw new Error("Vercel CLI output did not include a deployment URL.");
    const deployment: Deployment = {
      id: `vercel-${request.project.projectId}`,
      projectId: request.project.id,
      provider: this.name,
      providerMode: this.mode,
      url,
      status: "DEPLOYED",
      deployedAt: new Date().toISOString(),
    };
    this.#byKey.set(idempotencyKey, deployment);
    this.#byId.set(deployment.id, deployment);
    return structuredClone(deployment);
  }

  async getStatus(deploymentId: string): Promise<Deployment | null> {
    const known = this.#byId.get(deploymentId);
    return known ? structuredClone(known) : null;
  }

  async health(): Promise<IntegrationHealth> {
    const result = await runProcess(this.executable, ["--version"], {
      timeoutMs: 5_000,
    }).catch(() => null);
    return {
      integration: "deployment",
      provider: this.name,
      mode: this.mode,
      status: result?.exitCode === 0 ? "CONNECTED" : "DEGRADED",
      message: result?.exitCode === 0 ? "Vercel CLI and token are configured." : "Vercel CLI is unavailable.",
      checkedAt: new Date().toISOString(),
    };
  }
}
