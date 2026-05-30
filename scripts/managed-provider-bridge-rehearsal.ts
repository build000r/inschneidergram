import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { buildServer } from "../src/server.js";
import type { CreateCampaignInput } from "../src/domain/campaign.js";
import { launchAuthorizationSchema } from "../src/domain/launchAuthorization.js";
import {
  assertPilotIntakeKit,
  loadPilotIntakeKit,
  parsePilotIntakeArgs,
  renewLaunchAuthorizationWindow,
  selectedPilotSenderAccounts,
  type PilotIntakeKit
} from "./validate-pilot-intake.js";

export const providerBridgePath = "examples/managed-provider-bridge.example.json";

const providerOutcomeEventSchema = z.object({
  type: z.enum(["sent", "failed", "restricted", "replied"]),
  occurredAt: z.string().datetime().optional(),
  messageId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  replyText: z.string().min(1).optional(),
  evidence: z.record(z.string(), z.string()).default({})
});

const providerBridgeSchema = z.object({
  provider: z.object({
    id: z.string().min(1).max(120),
    endpoint: z.string().url(),
    accountRiskOwner: z.enum(["operator", "provider"]).default("provider"),
    requiresHumanEvidence: z.boolean().default(false),
    notes: z.array(z.string().min(1).max(1000)).default([])
  }),
  launchAuthorization: launchAuthorizationSchema.refine(
    (authorization) => authorization.deliveryPath === "managed_provider",
    "launchAuthorization.deliveryPath must be managed_provider"
  ),
  outcomes: z
    .array(
      z.object({
        target: z.string().min(1),
        outcome: z.enum(["accepted", "rejected"]),
        events: z.array(providerOutcomeEventSchema).min(1)
      })
    )
    .min(1),
  replyAssessments: z
    .array(
      z.object({
        targetHandle: z.string().min(1),
        disposition: z.enum(["interested", "neutral", "not_interested", "opt_out", "complaint"]),
        qualified: z.boolean(),
        replyText: z.string().min(1).optional(),
        note: z.string().min(1).optional()
      })
    )
    .default([]),
  incidents: z
    .array(
      z.object({
        kind: z.enum([
          "sender_warning",
          "sender_restriction",
          "delivery_failure",
          "quality_issue",
          "opt_out",
          "complaint",
          "manual_note"
        ]),
        severity: z.enum(["info", "warning", "critical"]),
        at: z.string().datetime(),
        note: z.string().min(1),
        targetHandle: z.string().min(1).optional(),
        senderAccountId: z.string().min(1).optional()
      })
    )
    .default([])
});

export type ProviderBridgeFixture = z.infer<typeof providerBridgeSchema>;

export interface ProviderBridgeFixtureLoadOptions {
  now?: Date;
  refreshDefaultExampleAuthorization?: boolean;
}

export interface ManagedProviderBridgeRehearsalResult {
  campaignId: string;
  executionId: string;
  providerEndpoint: string;
  handoffTargetCount: number;
  outcomeCount: number;
  bridgeRequest: {
    provider: {
      id: string;
      endpoint: string;
      accountRiskOwner: string;
    };
    campaignId: string;
    launchAuthorizationReference: string;
    sendIntents: Array<{
      target: string;
      targetHandle: string;
      senderAccountId: string;
      scheduledAt: string;
      message: string;
    }>;
    outcomeContract: string;
  };
  proofMetrics: {
    contactedTargets: number;
    sentMessages: number;
    replies: number;
    interestedReplies: number;
    deliveryFailures: number;
    senderWarnings: number;
    webhookDelivered: number;
    webhookDeadLetters: number;
  };
  readiness: {
    status: string;
    readyForEvidenceReview: boolean;
    externalInputs: string[];
  };
}

export async function runManagedProviderBridgeRehearsal(
  kit: PilotIntakeKit,
  fixture: ProviderBridgeFixture
): Promise<ManagedProviderBridgeRehearsalResult> {
  assertPilotIntakeKit(kit);
  const app = await buildServer({
    webhookSecret: "managed-provider-bridge-secret",
    webhookAllowedHosts: kit.webhook.allowedHosts
  });

  try {
    for (const sender of selectedPilotSenderAccounts(kit.campaignInput, kit.sendersInput.senders)) {
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
      actor: fixture.launchAuthorization.actor
    });

    const handoff = buildBridgeRequest({
      campaign,
      campaignInput: kit.campaignInput,
      fixture,
      campaignId
    });

    const execution = await injectJson(app, "POST", `/campaigns/${campaignId}/executions`, {
      adapter: {
        kind: "managed_provider",
        id: fixture.provider.id,
        accountRiskOwner: fixture.provider.accountRiskOwner,
        requiresHumanEvidence: fixture.provider.requiresHumanEvidence,
        notes: fixture.provider.notes,
        outcomes: fixture.outcomes
      },
      launchAuthorization: fixture.launchAuthorization,
      simulateWebhooks: true,
      replyAssessments: fixture.replyAssessments,
      incidents: fixture.incidents
    });
    const executionId = stringField(execution, "executionId");
    const proofPack = recordField(execution, "proofPack");
    const readiness = await injectJson(app, "GET", `/campaigns/${campaignId}/readiness`);

    return {
      campaignId,
      executionId,
      providerEndpoint: fixture.provider.endpoint,
      handoffTargetCount: handoff.sendIntents.length,
      outcomeCount: fixture.outcomes.length,
      bridgeRequest: handoff,
      proofMetrics: proofMetrics(proofPack),
      readiness: {
        status: stringField(readiness, "status"),
        readyForEvidenceReview: booleanField(readiness, "readyForEvidenceReview"),
        externalInputs: stringArrayField(readiness, "externalInputs")
      }
    };
  } finally {
    await app.close();
  }
}

function buildBridgeRequest(input: {
  campaign: Record<string, unknown>;
  campaignInput: CreateCampaignInput;
  fixture: ProviderBridgeFixture;
  campaignId: string;
}): ManagedProviderBridgeRehearsalResult["bridgeRequest"] {
  const targets = objectArrayField(input.campaign, "targets")
    .filter((target) => stringField(target, "status") === "scheduled")
    .map((target) => ({
      target: stringField(target, "raw"),
      targetHandle: stringField(target, "handle"),
      senderAccountId: stringField(target, "sender"),
      scheduledAt: stringField(target, "scheduledAt"),
      message: input.campaignInput.message ?? input.campaignInput.template?.body ?? ""
    }));

  return {
    provider: {
      id: input.fixture.provider.id,
      endpoint: input.fixture.provider.endpoint,
      accountRiskOwner: input.fixture.provider.accountRiskOwner
    },
    campaignId: input.campaignId,
    launchAuthorizationReference: input.fixture.launchAuthorization.reference,
    sendIntents: targets,
    outcomeContract:
      "Provider must return exactly one accepted/rejected outcome with one or more sent/failed/restricted/replied events for every approved target."
  };
}

function proofMetrics(proofPack: Record<string, unknown>): ManagedProviderBridgeRehearsalResult["proofMetrics"] {
  const metrics = recordField(proofPack, "metrics");
  return {
    contactedTargets: numberField(metrics, "contactedTargets"),
    sentMessages: numberField(metrics, "sentMessages"),
    replies: numberField(metrics, "replies"),
    interestedReplies: numberField(metrics, "interestedReplies"),
    deliveryFailures: numberField(metrics, "deliveryFailures"),
    senderWarnings: numberField(metrics, "senderWarnings"),
    webhookDelivered: numberField(metrics, "webhookDelivered"),
    webhookDeadLetters: numberField(metrics, "webhookDeadLetters")
  };
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

function targetRaw(target: CreateCampaignInput["targets"][number]): string {
  return typeof target === "string" ? target : target.target;
}

export async function loadProviderBridgeFixture(
  path = providerBridgePath,
  options: ProviderBridgeFixtureLoadOptions = {}
): Promise<ProviderBridgeFixture> {
  try {
    const fixture = providerBridgeSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
    return shouldRefreshDefaultProviderAuthorization(path, options)
      ? {
          ...fixture,
          launchAuthorization: renewLaunchAuthorizationWindow(
            fixture.launchAuthorization,
            options.now
          )
        }
      : fixture;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`provider bridge fixture is invalid:\n${formatZodError(error)}`);
    }
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to read ${path}: ${detail}`);
  }
}

function shouldRefreshDefaultProviderAuthorization(
  path: string,
  options: ProviderBridgeFixtureLoadOptions
): boolean {
  return (
    options.refreshDefaultExampleAuthorization !== false &&
    resolve(path) === resolve(providerBridgePath)
  );
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Expected object field ${key}`);
  }
  return value;
}

function objectArrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
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
  const kit = await loadPilotIntakeKit(parsePilotIntakeArgs(process.argv.slice(2)));
  const fixture = await loadProviderBridgeFixture();
  const result = await runManagedProviderBridgeRehearsal(kit, fixture);

  console.log("# Managed Provider Bridge Rehearsal");
  console.log("");
  console.log(`Campaign ID: ${result.campaignId}`);
  console.log(`Execution ID: ${result.executionId}`);
  console.log(`Provider endpoint: ${result.providerEndpoint}`);
  console.log(`Bridge handoff targets: ${result.handoffTargetCount}`);
  console.log(`Provider outcomes consumed: ${result.outcomeCount}`);
  console.log(`Readiness: ${result.readiness.status}`);
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
