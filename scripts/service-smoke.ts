import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface HealthResponse {
  ok: boolean;
  service: string;
  provider: string;
}

interface CampaignResponse {
  campaignId: string;
}

interface ExecutionResponse {
  executionId: string;
  proofPack: {
    metrics: {
      contactedTargets: number;
      sentMessages: number;
    };
  };
}

interface ReadinessResponse {
  status: string;
  readyForExecution: boolean;
  counts: {
    contactedTargets: number;
  };
}

interface FetchJsonInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function main(): Promise<void> {
  const distIndex = resolve("dist/index.js");
  if (!(await exists(distIndex))) {
    throw new Error("Run npm run build before npm run smoke:service.");
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = await mkdtemp(join(tmpdir(), "inschneidergram-service-smoke-"));
  const storePath = join(tempDir, "campaigns.json");
  const apiKey = "service-smoke-key";
  const child = spawn(process.execPath, [distIndex], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      INSCHNEIDERGRAM_PROVIDER: "service-smoke",
      INSCHNEIDERGRAM_STORE_PATH: storePath,
      INSCHNEIDERGRAM_WEBHOOK_SECRET: "service-smoke-secret",
      INSCHNEIDERGRAM_API_KEY: apiKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let exit:
    | {
        code: number | null;
        signal: NodeJS.Signals | null;
      }
    | null = null;

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });

  try {
    const health = await waitForHealth(baseUrl, () => exit, () => ({ stdout, stderr }));
    const openapi = await fetchJson<{ paths: Record<string, unknown> }>(baseUrl, "/openapi.json");
    await assertRouteRequiresApiKey(baseUrl, "/campaigns");
    const protectedFetch = <T>(path: string, init: FetchJsonInit = {}) =>
      fetchJson<T>(baseUrl, path, {
        ...init,
        headers: {
          ...init.headers,
          "x-api-key": apiKey
        }
      });
    await protectedFetch("/senders/sender-a", {
      method: "PUT",
      body: {
        dailyLimit: 20,
        warmupNote: "service smoke sender"
      }
    });
    const campaign = await protectedFetch<CampaignResponse>("/campaigns", {
      method: "POST",
      body: {
        targets: ["@service_smoke_creator"],
        message: "Open to a managed creator outreach pilot?",
        campaign: "service_smoke",
        settings: {
          senderPool: ["sender-a"]
        }
      }
    });
    const initialReadiness = await protectedFetch<ReadinessResponse>(
      `/campaigns/${campaign.campaignId}/readiness`
    );
    if (initialReadiness.status !== "needs_approval") {
      throw new Error(`Expected needs_approval before approval, got ${initialReadiness.status}`);
    }

    await protectedFetch(`/campaigns/${campaign.campaignId}/approval-workbench`, {
      method: "POST",
      body: {
        approvedTargets: ["@service_smoke_creator"],
        approveMessage: true,
        actor: "service-smoke"
      }
    });
    const approvedReadiness = await protectedFetch<ReadinessResponse>(
      `/campaigns/${campaign.campaignId}/readiness`
    );
    if (!approvedReadiness.readyForExecution) {
      throw new Error(`Expected campaign to be ready for execution, got ${approvedReadiness.status}`);
    }

    const execution = await protectedFetch<ExecutionResponse>(
      `/campaigns/${campaign.campaignId}/executions`,
      {
        method: "POST",
        body: {
          adapter: {
            kind: "managed_provider",
            id: "service_smoke_provider",
            accountRiskOwner: "provider",
            notes: ["Service smoke provider contract; not live Instagram delivery."],
            outcomes: [
              {
                target: "@service_smoke_creator",
                outcome: "accepted",
                events: [
                  {
                    type: "sent",
                    messageId: "service_smoke_msg_1",
                    evidence: {
                      providerRunId: "service-smoke"
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    );
    const finalReadiness = await protectedFetch<ReadinessResponse>(
      `/campaigns/${campaign.campaignId}/readiness`
    );
    if (finalReadiness.status !== "evidence_ready") {
      throw new Error(`Expected evidence_ready after execution, got ${finalReadiness.status}`);
    }
    const proofExport = await protectedFetch<{
      latestExecution: { id: string };
      metrics: { contactedTargets: number; sentMessages: number };
      readiness: { status: string };
    }>(`/campaigns/${campaign.campaignId}/proof-pack`);
    if (proofExport.latestExecution.id !== execution.executionId) {
      throw new Error(
        `Expected proof export to use ${execution.executionId}, got ${proofExport.latestExecution.id}`
      );
    }
    if (proofExport.readiness.status !== "evidence_ready") {
      throw new Error(`Expected proof export readiness evidence_ready, got ${proofExport.readiness.status}`);
    }

    console.log(
      JSON.stringify(
        {
          health,
          apiAuth: "enabled",
          openApiPathCount: Object.keys(openapi.paths).length,
          campaignId: campaign.campaignId,
          executionId: execution.executionId,
          contactedTargets: execution.proofPack.metrics.contactedTargets,
          sentMessages: execution.proofPack.metrics.sentMessages,
          proofExportContactedTargets: proofExport.metrics.contactedTargets,
          readiness: finalReadiness.status,
          storePath
        },
        null,
        2
      )
    );
  } finally {
    await stopChild(child);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function waitForHealth(
  baseUrl: string,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getOutput: () => { stdout: string; stderr: string }
): Promise<HealthResponse> {
  const deadline = Date.now() + 30_000;
  let lastError = "service did not respond";

  while (Date.now() < deadline) {
    const exit = getExit();
    if (exit) {
      const output = getOutput();
      throw new Error(
        `Service exited before health check passed: ${JSON.stringify(exit)}\n${output.stdout}${output.stderr}`
      );
    }

    try {
      const response = await fetch(`${baseUrl}/health`);
      const text = await response.text();
      if (response.ok) {
        const health = JSON.parse(text) as HealthResponse;
        if (health.ok) {
          return health;
        }
      }
      lastError = text;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(150);
  }

  const output = getOutput();
  throw new Error(
    `Timed out waiting for /health. Last error: ${lastError}\n${output.stdout}${output.stderr}`
  );
}

async function assertRouteRequiresApiKey(baseUrl: string, path: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (response.status !== 401) {
    throw new Error(`Expected GET ${path} to require API key, got ${response.status}: ${text}`);
  }
}

async function fetchJson<T>(baseUrl: string, path: string, init: FetchJsonInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers:
      init.body === undefined
        ? init.headers
        : {
            "content-type": "application/json",
            ...init.headers
          },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed with ${response.status}: ${text}`);
  }

  return body as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local port for service smoke");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(2_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    })
  ]);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
