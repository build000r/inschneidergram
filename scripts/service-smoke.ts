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
  adapterRiskPosture?: {
    kind: string;
  };
  proofPack: {
    metrics: {
      contactedTargets: number;
      sentMessages: number;
      replies?: number;
      interestedReplies?: number;
      deliveryFailures?: number;
      senderWarnings?: number;
      webhookDelivered?: number;
      webhookDeadLetters?: number;
    };
    renewalRecommendation?: {
      decision: string;
    };
  };
}

interface ReadinessResponse {
  status: string;
  readyForExecution: boolean;
  externalInputs: string[];
  counts: {
    contactedTargets: number;
  };
}

interface ManualQueueResponse {
  counts: {
    total: number;
    pendingInitialEvidence: number;
    replyMonitoring: number;
    done: number;
  };
  items: unknown[];
}

interface OperatorDashboardResponse {
  counts: {
    campaigns: number;
    readyForEvidenceReview: number;
  };
  senderHealth: {
    blocked: number;
  };
  manualQueue: {
    counts: ManualQueueResponse["counts"];
  };
  webhooks: {
    deadLetters: number;
  };
  urgentActions: Array<{
    kind: string;
  }>;
}

interface FetchJsonInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

type ProtectedFetch = <T>(path: string, init?: FetchJsonInit) => Promise<T>;

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
    await assertRouteRequiresApiKey(baseUrl, "/pilot-launch-packet");
    await assertRouteRequiresApiKey(baseUrl, "/operator/dashboard");
    const protectedFetch = <T>(path: string, init: FetchJsonInit = {}) =>
      fetchJson<T>(baseUrl, path, {
        ...init,
        headers: {
          ...init.headers,
          "x-api-key": apiKey
        }
      });
    const launchPacket = await protectedFetch<{
      requiredExternalInputs: string[];
      routeMap: { createCampaign: string };
    }>("/pilot-launch-packet");
    if (launchPacket.routeMap.createCampaign !== "/campaigns") {
      throw new Error("Pilot launch packet did not include the campaign creation route");
    }
    if (
      !launchPacket.requiredExternalInputs.includes(
        "vetted Instagram creator list with source and fit rationale"
      )
    ) {
      throw new Error("Pilot launch packet did not include the vetted creator-list input");
    }
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
    if (approvedReadiness.status !== "needs_approval") {
      throw new Error(
        `Expected needs_approval until launch authorization is supplied, got ${approvedReadiness.status}`
      );
    }
    if (
      !approvedReadiness.externalInputs.includes(
        "permission to run the selected pilot delivery path"
      )
    ) {
    throw new Error("Expected approved campaign readiness to require launch authorization");
  }

  const providerAuthorizationApprovedAt = new Date();
  const providerAuthorizationExpiresAt = new Date(
    providerAuthorizationApprovedAt.getTime() + 7 * 24 * 60 * 60 * 1000
  );
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
          },
          launchAuthorization: {
            actor: "service-smoke-approver",
            deliveryPath: "managed_provider",
            approvedTargetLimit: 1,
            approvedAt: providerAuthorizationApprovedAt.toISOString(),
            expiresAt: providerAuthorizationExpiresAt.toISOString(),
            reference: "service-smoke-launch-approval",
            evidenceUrl: "https://docs.graphed.com/approvals/service-smoke-launch-approval",
            notes: "Local smoke authorization; not live Instagram delivery."
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
    const manualServicePath = await runManualServicePath(protectedFetch);
    const dashboard = await protectedFetch<OperatorDashboardResponse>("/operator/dashboard");
    if (dashboard.counts.campaigns !== 2 || dashboard.counts.readyForEvidenceReview !== 2) {
      throw new Error(`Unexpected dashboard campaign counts: ${JSON.stringify(dashboard.counts)}`);
    }
    if (dashboard.manualQueue.counts.done !== 2 || dashboard.manualQueue.counts.total !== 2) {
      throw new Error(
        `Unexpected dashboard manual queue counts: ${JSON.stringify(dashboard.manualQueue.counts)}`
      );
    }
    if (dashboard.senderHealth.blocked !== 1) {
      throw new Error(`Expected one blocked sender in dashboard, got ${dashboard.senderHealth.blocked}`);
    }
    if (dashboard.webhooks.deadLetters !== 0) {
      throw new Error(`Expected zero dashboard dead letters, got ${dashboard.webhooks.deadLetters}`);
    }
    if (!dashboard.urgentActions.some((action) => action.kind === "sender_health")) {
      throw new Error("Expected dashboard to surface sender health action after restriction evidence");
    }

    console.log(
      JSON.stringify(
        {
          health,
          apiAuth: "enabled",
          openApiPathCount: Object.keys(openapi.paths).length,
          launchPacketInputs: launchPacket.requiredExternalInputs.length,
          campaignId: campaign.campaignId,
          executionId: execution.executionId,
          contactedTargets: execution.proofPack.metrics.contactedTargets,
          sentMessages: execution.proofPack.metrics.sentMessages,
          proofExportContactedTargets: proofExport.metrics.contactedTargets,
          manualServicePath,
          operatorDashboard: {
            campaigns: dashboard.counts.campaigns,
            readyForEvidenceReview: dashboard.counts.readyForEvidenceReview,
            manualQueueDone: dashboard.manualQueue.counts.done,
            senderBlocked: dashboard.senderHealth.blocked,
            deadLetters: dashboard.webhooks.deadLetters
          },
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

async function runManualServicePath(protectedFetch: ProtectedFetch) {
  await protectedFetch("/senders/sender-b", {
    method: "PUT",
    body: {
      status: "healthy",
      dailyLimit: 10,
      warmupNote: "manual service smoke backup sender"
    }
  });

  const campaign = await protectedFetch<CampaignResponse>("/campaigns", {
    method: "POST",
    body: {
      targets: [
        {
          target: "@service_manual_creator_one",
          profileUrl: "https://www.instagram.com/service_manual_creator_one/",
          displayName: "Service Manual Creator One",
          source: "service-smoke:manual-row-1",
          fitReason: "Matches the low-volume managed manual pilot path",
          tags: ["creator", "manual", "service-smoke"],
          followerCount: 12_400,
          engagementRate: 4.2
        },
        {
          target: "@service_manual_creator_two",
          profileUrl: "https://www.instagram.com/service_manual_creator_two/",
          displayName: "Service Manual Creator Two",
          source: "service-smoke:manual-row-2",
          fitReason: "Exercises restricted evidence and sender risk reconciliation",
          tags: ["creator", "manual", "risk-smoke"],
          followerCount: 17_900,
          engagementRate: 3.7
        }
      ],
      message: "Open to a managed manual creator outreach pilot?",
      campaign: "service_manual_smoke",
      metadata: {
        source: "smoke:service",
        client: "graphed"
      },
      settings: {
        webhookUrl: "https://example.com/webhooks/service-manual-smoke",
        senderPool: ["sender-a", "sender-b"],
        requireTargetProvenance: true
      }
    }
  });

  await protectedFetch(`/campaigns/${campaign.campaignId}/approval-workbench`, {
    method: "POST",
    body: {
      approvedTargets: ["@service_manual_creator_one", "@service_manual_creator_two"],
      approveMessage: true,
      actor: "service-smoke-approver"
    }
  });
  const workbench = await protectedFetch<{
    approvalWorkbench: { candidates: Array<{ id: string }> };
  }>(`/campaigns/${campaign.campaignId}/approval-workbench`);
  for (const candidate of workbench.approvalWorkbench.candidates) {
    await protectedFetch(
      `/campaigns/${campaign.campaignId}/approval-workbench/candidates/${candidate.id}/claim`,
      {
        method: "POST",
        body: {
          operator: "service-smoke-operator"
        }
      }
    );
  }

  const manualAuthorizationApprovedAt = new Date();
  const manualAuthorizationExpiresAt = new Date(
    manualAuthorizationApprovedAt.getTime() + 7 * 24 * 60 * 60 * 1000
  );
  const execution = await protectedFetch<ExecutionResponse>(
    `/campaigns/${campaign.campaignId}/executions`,
    {
      method: "POST",
      body: {
        adapter: { kind: "manual" },
        launchAuthorization: {
          actor: "service-smoke-approver",
          deliveryPath: "manual",
          approvedTargetLimit: 2,
          approvedAt: manualAuthorizationApprovedAt.toISOString(),
          expiresAt: manualAuthorizationExpiresAt.toISOString(),
          reference: "service-smoke-manual-launch-approval",
          evidenceUrl: "https://docs.graphed.com/approvals/service-smoke-manual-launch-approval",
          notes: "Compiled-service manual path smoke; no live Instagram delivery."
        }
      }
    }
  );
  if (execution.adapterRiskPosture?.kind !== "manual") {
    throw new Error(`Expected manual adapter posture, got ${execution.adapterRiskPosture?.kind}`);
  }

  const queued = await protectedFetch<ManualQueueResponse>(
    `/operator/manual-queue?campaignId=${campaign.campaignId}`
  );
  if (queued.counts.pendingInitialEvidence !== 2) {
    throw new Error(
      `Expected 2 pending manual evidence items, got ${queued.counts.pendingInitialEvidence}`
    );
  }

  await protectedFetch(
    `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
    {
      method: "POST",
      body: {
        eventId: "service-manual-sent-1",
        target: "@service_manual_creator_one",
        type: "sent",
        occurredAt: "2026-05-30T01:15:00.000Z",
        messageId: "service_manual_msg_1",
        simulateWebhookDelivery: true,
        evidence: {
          operatorId: "service-smoke-operator",
          conversationUrl: "https://instagram.com/direct/t/service_manual_creator_one",
          screenshotUrl: "s3://proof/service-manual-sent.png"
        }
      }
    }
  );
  await protectedFetch(
    `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
    {
      method: "POST",
      body: {
        eventId: "service-manual-reply-1",
        target: "@service_manual_creator_one",
        type: "replied",
        occurredAt: "2026-05-30T01:45:00.000Z",
        messageId: "service_manual_msg_1",
        replyText: "Interested - send the brief",
        simulateWebhookDelivery: true,
        evidence: {
          operatorId: "service-smoke-operator",
          conversationUrl: "https://instagram.com/direct/t/service_manual_creator_one",
          screenshotUrl: "s3://proof/service-manual-reply.png",
          replyCapturedAt: "2026-05-30T01:45:00.000Z"
        },
        replyAssessment: {
          disposition: "interested",
          qualified: true,
          note: "Service smoke creator asked for the brief"
        }
      }
    }
  );
  const finalEvidence = await protectedFetch<{
    proofPack: ExecutionResponse["proofPack"];
  }>(`/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`, {
    method: "POST",
    body: {
      eventId: "service-manual-restricted-1",
      target: "@service_manual_creator_two",
      type: "restricted",
      occurredAt: "2026-05-30T01:50:00.000Z",
      reason: "Service smoke restricted path",
      simulateWebhookDelivery: true,
      evidence: {
        operatorId: "service-smoke-operator",
        screenshotUrl: "s3://proof/service-manual-restricted.png",
        restrictionSource: "service-smoke"
      }
    }
  });
  const finalReadiness = await protectedFetch<ReadinessResponse>(
    `/campaigns/${campaign.campaignId}/readiness`
  );
  if (finalReadiness.status !== "evidence_ready") {
    throw new Error(`Expected manual service path evidence_ready, got ${finalReadiness.status}`);
  }
  const finalQueue = await protectedFetch<ManualQueueResponse>(
    `/operator/manual-queue?campaignId=${campaign.campaignId}&status=all`
  );
  if (finalQueue.counts.done !== 2) {
    throw new Error(`Expected 2 completed manual queue items, got ${finalQueue.counts.done}`);
  }
  const metrics = finalEvidence.proofPack.metrics;
  if (
    metrics.contactedTargets !== 1 ||
    metrics.interestedReplies !== 1 ||
    metrics.deliveryFailures !== 1 ||
    metrics.senderWarnings !== 1 ||
    metrics.webhookDelivered !== 3 ||
    metrics.webhookDeadLetters !== 0
  ) {
    throw new Error(`Unexpected manual service proof metrics: ${JSON.stringify(metrics)}`);
  }

  return {
    campaignId: campaign.campaignId,
    executionId: execution.executionId,
    readiness: finalReadiness.status,
    queueDone: finalQueue.counts.done,
    contactedTargets: metrics.contactedTargets,
    interestedReplies: metrics.interestedReplies,
    deliveryFailures: metrics.deliveryFailures,
    senderWarnings: metrics.senderWarnings,
    webhookDelivered: metrics.webhookDelivered,
    webhookDeadLetters: metrics.webhookDeadLetters,
    renewalDecision: finalEvidence.proofPack.renewalRecommendation?.decision
  };
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
