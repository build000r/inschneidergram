import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { CreateCampaignInput } from "../src/domain/campaign.js";
import {
  assertPilotIntakeKit,
  loadPilotIntakeKit,
  parsePilotIntakeArgs,
  selectedPilotSenderAccounts,
  type PilotIntakeKit
} from "./validate-pilot-intake.js";

export interface PilotIntakeApiRehearsalResult {
  campaignId: string;
  executionId: string;
  registeredSenders: string[];
  campaignSummary: {
    total: number;
    scheduled: number;
    blockedPolicy: number;
    skippedDuplicate: number;
  };
  readinessBeforeExecution: {
    status: string;
    readyForExecution: boolean;
    externalInputs: string[];
  };
  readinessAfterExecution: {
    status: string;
    readyForExecution: boolean;
    readyForEvidenceReview: boolean;
    pendingManualEvidence: number;
    externalInputs: string[];
  };
  manualQueue: {
    pendingInitialEvidence: number;
    replyMonitoring: number;
    done: number;
    items: number;
  };
  operatorDashboard: {
    campaigns: number;
    awaitingManualEvidence: number;
    manualQueuePending: number;
    senderBlocked: number;
    deadLetters: number;
  };
  sourceUrls: {
    campaign: string;
    readiness: string;
    handoff: string;
    execution: string;
    manualQueue: string;
    proofPack: string;
    proofPacket: string;
    dashboard: string;
  };
  nextActions: string[];
}

export async function runPilotIntakeApiRehearsal(
  kit: PilotIntakeKit
): Promise<PilotIntakeApiRehearsalResult> {
  assertPilotIntakeKit(kit);
  const app = await buildServer({
    webhookSecret: "pilot-intake-rehearsal-secret",
    webhookAllowedHosts: kit.webhook.allowedHosts
  });

  try {
    const selectedSenders = selectedPilotSenderAccounts(
      kit.campaignInput,
      kit.sendersInput.senders
    );
    for (const sender of selectedSenders) {
      await injectJson(app, "PUT", `/senders/${encodeURIComponent(sender.id)}`, {
        status: sender.status,
        dailyLimit: sender.dailyLimit,
        ...(sender.cooldownUntil ? { cooldownUntil: sender.cooldownUntil } : {}),
        ...(sender.warmupNote ? { warmupNote: sender.warmupNote } : {}),
        riskEvents: sender.riskEvents
      });
    }

    const campaign = await injectJson(app, "POST", "/campaigns", kit.campaignInput);
    const campaignId = stringField(campaign, "campaignId");

    await injectJson(app, "POST", `/campaigns/${campaignId}/approval-workbench`, {
      approvedTargets: kit.campaignInput.targets.map(targetRaw),
      approveMessage: true,
      actor: kit.launchAuthorization.actor
    });

    const workbenchResponse = await injectJson(
      app,
      "GET",
      `/campaigns/${campaignId}/approval-workbench`
    );
    const candidates = arrayField(
      recordField(workbenchResponse, "approvalWorkbench"),
      "candidates"
    );
    for (const candidate of candidates) {
      await injectJson(
        app,
        "POST",
        `/campaigns/${campaignId}/approval-workbench/candidates/${stringField(candidate, "id")}/claim`,
        {
          operator: kit.launchAuthorization.actor
        }
      );
    }

    const readinessBeforeExecution = await injectJson(
      app,
      "GET",
      `/campaigns/${campaignId}/readiness`
    );
    const execution = await injectJson(app, "POST", `/campaigns/${campaignId}/executions`, {
      adapter: { kind: "manual" },
      launchAuthorization: kit.launchAuthorization,
      simulateWebhooks: true
    });
    const executionId = stringField(execution, "executionId");
    const readinessAfterExecution = await injectJson(
      app,
      "GET",
      `/campaigns/${campaignId}/readiness`
    );
    const manualQueue = await injectJson(
      app,
      "GET",
      `/campaigns/${campaignId}/executions/${executionId}/manual-queue`
    );
    const handoff = await injectJson(app, "GET", `/campaigns/${campaignId}/pilot-handoff`);
    const dashboard = await injectJson(app, "GET", "/operator/dashboard");

    return summarizeRehearsal({
      campaign,
      campaignId,
      executionId,
      handoff,
      manualQueue,
      readinessAfterExecution,
      readinessBeforeExecution,
      dashboard,
      registeredSenders: selectedSenders.map((sender) => sender.id)
    });
  } finally {
    await app.close();
  }
}

interface RehearsalSummaryInput {
  campaign: Record<string, unknown>;
  campaignId: string;
  executionId: string;
  handoff: Record<string, unknown>;
  manualQueue: Record<string, unknown>;
  readinessBeforeExecution: Record<string, unknown>;
  readinessAfterExecution: Record<string, unknown>;
  dashboard: Record<string, unknown>;
  registeredSenders: string[];
}

function summarizeRehearsal(input: RehearsalSummaryInput): PilotIntakeApiRehearsalResult {
  const campaignSummary = recordField(input.campaign, "summary");
  const afterCounts = recordField(input.readinessAfterExecution, "counts");
  const manualQueueCounts = recordField(input.manualQueue, "counts");
  const dashboardCounts = recordField(input.dashboard, "counts");
  const dashboardReadinessCounts = recordField(dashboardCounts, "readiness");
  const dashboardManualQueue = recordField(recordField(input.dashboard, "manualQueue"), "counts");
  const dashboardSenderHealth = recordField(input.dashboard, "senderHealth");
  const dashboardWebhooks = recordField(input.dashboard, "webhooks");

  return {
    campaignId: input.campaignId,
    executionId: input.executionId,
    registeredSenders: input.registeredSenders,
    campaignSummary: {
      total: numberField(campaignSummary, "total"),
      scheduled: numberField(campaignSummary, "scheduled"),
      blockedPolicy: numberField(campaignSummary, "blockedPolicy"),
      skippedDuplicate: numberField(campaignSummary, "skippedDuplicate")
    },
    readinessBeforeExecution: {
      status: stringField(input.readinessBeforeExecution, "status"),
      readyForExecution: booleanField(input.readinessBeforeExecution, "readyForExecution"),
      externalInputs: stringArrayField(input.readinessBeforeExecution, "externalInputs")
    },
    readinessAfterExecution: {
      status: stringField(input.readinessAfterExecution, "status"),
      readyForExecution: booleanField(input.readinessAfterExecution, "readyForExecution"),
      readyForEvidenceReview: booleanField(
        input.readinessAfterExecution,
        "readyForEvidenceReview"
      ),
      pendingManualEvidence: numberField(afterCounts, "pendingManualEvidence"),
      externalInputs: stringArrayField(input.readinessAfterExecution, "externalInputs")
    },
    manualQueue: {
      pendingInitialEvidence: numberField(manualQueueCounts, "pendingInitialEvidence"),
      replyMonitoring: numberField(manualQueueCounts, "replyMonitoring"),
      done: numberField(manualQueueCounts, "done"),
      items: arrayField(input.manualQueue, "items").length
    },
    operatorDashboard: {
      campaigns: numberField(dashboardCounts, "campaigns"),
      awaitingManualEvidence: numberField(dashboardReadinessCounts, "awaiting_manual_evidence"),
      manualQueuePending: numberField(dashboardManualQueue, "pendingInitialEvidence"),
      senderBlocked: numberField(dashboardSenderHealth, "blocked"),
      deadLetters: numberField(dashboardWebhooks, "deadLetters")
    },
    sourceUrls: {
      campaign: `/campaigns/${input.campaignId}`,
      readiness: `/campaigns/${input.campaignId}/readiness`,
      handoff: `/campaigns/${input.campaignId}/pilot-handoff`,
      execution: `/campaigns/${input.campaignId}/executions/${input.executionId}`,
      manualQueue: `/campaigns/${input.campaignId}/executions/${input.executionId}/manual-queue`,
      proofPack: `/campaigns/${input.campaignId}/proof-pack`,
      proofPacket: `/campaigns/${input.campaignId}/proof-packet`,
      dashboard: "/operator/dashboard"
    },
    nextActions: actionLabelsField(input.handoff, "nextActions")
  };
}

function targetRaw(target: CreateCampaignInput["targets"][number]): string {
  return typeof target === "string" ? target : target.target;
}

async function injectJson(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT",
  url: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method,
    url,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          payload: JSON.stringify(body)
        })
  });

  const payload = response.json() as unknown;
  if (response.statusCode >= 400) {
    throw new Error(`${method} ${url} failed with ${response.statusCode}: ${response.body}`);
  }
  if (!isRecord(payload)) {
    throw new Error(`${method} ${url} returned a non-object response`);
  }

  return payload;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Expected object field ${key}`);
  }
  return value;
}

function arrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`Expected object array field ${key}`);
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected string array field ${key}`);
  }
  return value;
}

function actionLabelsField(record: Record<string, unknown>, key: string): string[] {
  return arrayField(record, key).map((action) => stringField(action, "label"));
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string field ${key}`);
  }
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected number field ${key}`);
  }
  return value;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean field ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  const paths = parsePilotIntakeArgs(process.argv.slice(2));
  const kit = await loadPilotIntakeKit(paths);
  const result = await runPilotIntakeApiRehearsal(kit);

  console.log("# Pilot Intake API Rehearsal");
  console.log("");
  console.log(`Campaign ID: ${result.campaignId}`);
  console.log(`Execution ID: ${result.executionId}`);
  console.log(`Registered senders: ${result.registeredSenders.join(", ")}`);
  console.log(`Readiness before execution: ${result.readinessBeforeExecution.status}`);
  console.log(`Readiness after execution: ${result.readinessAfterExecution.status}`);
  console.log(`Pending manual evidence: ${result.manualQueue.pendingInitialEvidence}`);
  console.log("");
  console.log("## Machine Summary");
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
