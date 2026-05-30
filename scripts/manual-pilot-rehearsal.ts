import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

export interface ManualPilotRehearsalResult {
  campaignId: string;
  executionId: string;
  health: {
    ok: boolean;
    service: string;
    provider: string;
  };
  openApiPathCount: number;
  openApiPaths: string[];
  adapterRiskPosture: {
    kind: string;
    officialColdDmCompliance: string;
    accountRiskOwner: string;
    requiresHumanEvidence: boolean;
  };
  readinessTimeline: Array<{
    label: string;
    status: string;
    readyForExecution: boolean;
    readyForEvidenceReview: boolean;
    pendingManualEvidence: number;
    externalInputs: string[];
  }>;
  finalMetrics: {
    contactedTargets: number;
    sentMessages: number;
    replies: number;
    interestedReplies: number;
    deliveryFailures: number;
    webhookDelivered: number;
    webhookDeadLetters: number;
  };
  repeatedSentWebhookDelivery: unknown;
  executionListCount: number;
  persistedExecutionMetrics: {
    contactedTargets: number;
    interestedReplies: number;
    deliveryFailures: number;
  };
  renewalDecision: string;
  proofMarkdown: string;
}

export async function runManualPilotRehearsal(): Promise<ManualPilotRehearsalResult> {
  const app = await buildServer({ webhookSecret: "manual-rehearsal-secret" });

  try {
    const health = await injectJson(app, "GET", "/health");
    const openapi = await injectJson(app, "GET", "/openapi.json");
    const openApiPaths = Object.keys(openapi.paths);
    const campaign = await injectJson(app, "POST", "/campaigns", {
      targets: ["@manual_demo_creator_one", "@manual_demo_creator_two"],
      message: "Open to a short affiliate pilot with Graphed?",
      campaign: "manual_pilot_rehearsal",
      metadata: {
        source: "demo:manual-pilot",
        client: "graphed"
      },
      settings: {
        webhookUrl: "https://example.com/webhooks/inschneidergram",
        senderPool: ["sender-a"],
        senderAccounts: [
          {
            id: "sender-a",
            status: "healthy",
            dailyLimit: 10,
            warmupNote: "manual rehearsal sender; no live Instagram delivery",
            riskEvents: []
          }
        ],
        minDelaySeconds: 90,
        maxDelaySeconds: 420
      }
    });

    const readinessTimeline = [
      readinessPoint("created", await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/readiness`))
    ];

    await injectJson(app, "POST", `/campaigns/${campaign.campaignId}/approval-workbench`, {
      approvedTargets: ["@manual_demo_creator_one", "@manual_demo_creator_two"],
      approveMessage: true,
      actor: "demo-approver"
    });
    const workbench = await injectJson(
      app,
      "GET",
      `/campaigns/${campaign.campaignId}/approval-workbench`
    );
    for (const candidate of workbench.approvalWorkbench.candidates) {
      await injectJson(
        app,
        "POST",
        `/campaigns/${campaign.campaignId}/approval-workbench/candidates/${candidate.id}/claim`,
        {
          operator: "demo-operator"
        }
      );
    }
    readinessTimeline.push(
      readinessPoint(
        "approved_and_claimed",
        await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/readiness`)
      )
    );

    const execution = await injectJson(app, "POST", `/campaigns/${campaign.campaignId}/executions`, {
      adapter: { kind: "manual" }
    });
    const adapterRiskPosture = execution.adapterRiskPosture;
    readinessTimeline.push(
      readinessPoint(
        "manual_execution_created",
        await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/readiness`)
      )
    );

    const sentPayload = {
      target: "@manual_demo_creator_one",
      type: "sent",
      messageId: "manual_msg_1",
      evidence: {
        operatorId: "demo-operator",
        conversationUrl: "https://instagram.com/direct/t/manual_demo_creator_one",
        screenshotUrl: "s3://proof/manual-rehearsal-sent.png"
      }
    };
    await injectJson(
      app,
      "POST",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
      sentPayload,
      { "idempotency-key": "manual-rehearsal-sent-1" }
    );
    const repeatedSent = await injectJson(
      app,
      "POST",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
      sentPayload,
      { "idempotency-key": "manual-rehearsal-sent-1" }
    );
    await injectJson(
      app,
      "POST",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
      {
        eventId: "manual-rehearsal-reply-1",
        target: "@manual_demo_creator_one",
        type: "replied",
        messageId: "manual_msg_1",
        replyText: "Interested - send the brief",
        evidence: {
          operatorId: "demo-operator",
          conversationUrl: "https://instagram.com/direct/t/manual_demo_creator_one",
          screenshotUrl: "s3://proof/manual-rehearsal-reply.png",
          replyCapturedAt: "2026-05-30T01:45:00.000Z"
        },
        replyAssessment: {
          disposition: "interested",
          qualified: true,
          note: "Demo creator asked for the brief"
        }
      }
    );
    const finalEvidence = await injectJson(
      app,
      "POST",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
      {
        eventId: "manual-rehearsal-restricted-1",
        target: "@manual_demo_creator_two",
        type: "restricted",
        reason: "Manual rehearsal restricted path",
        evidence: {
          operatorId: "demo-operator",
          screenshotUrl: "s3://proof/manual-rehearsal-restricted.png",
          restrictionSource: "manual-rehearsal"
        }
      }
    );
    const finalReadiness = await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/readiness`);
    readinessTimeline.push(readinessPoint("evidence_recorded", finalReadiness));
    const executionList = await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/executions`);
    const persistedExecution = await injectJson(
      app,
      "GET",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}`
    );

    return {
      campaignId: campaign.campaignId,
      executionId: execution.executionId,
      health,
      openApiPathCount: openApiPaths.length,
      openApiPaths,
      adapterRiskPosture,
      readinessTimeline,
      finalMetrics: {
        contactedTargets: finalEvidence.proofPack.metrics.contactedTargets,
        sentMessages: finalEvidence.proofPack.metrics.sentMessages,
        replies: finalEvidence.proofPack.metrics.replies,
        interestedReplies: finalEvidence.proofPack.metrics.interestedReplies,
        deliveryFailures: finalEvidence.proofPack.metrics.deliveryFailures,
        webhookDelivered: finalEvidence.proofPack.metrics.webhookDelivered,
        webhookDeadLetters: finalEvidence.proofPack.metrics.webhookDeadLetters
      },
      repeatedSentWebhookDelivery: repeatedSent.webhookDelivery,
      executionListCount: executionList.executions.length,
      persistedExecutionMetrics: {
        contactedTargets: persistedExecution.proofPack.metrics.contactedTargets,
        interestedReplies: persistedExecution.proofPack.metrics.interestedReplies,
        deliveryFailures: persistedExecution.proofPack.metrics.deliveryFailures
      },
      renewalDecision: finalEvidence.proofPack.renewalRecommendation.decision,
      proofMarkdown: finalEvidence.proofPack.markdown
    };
  } finally {
    await app.close();
  }
}

async function injectJson(
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<any> {
  const response = await app.inject({
    method,
    url,
    headers: {
      "content-type": "application/json",
      ...headers
    },
    payload
  });
  const body = response.json();
  if (response.statusCode >= 400) {
    throw new Error(`${method} ${url} failed with ${response.statusCode}: ${JSON.stringify(body)}`);
  }
  return body;
}

function readinessPoint(label: string, readiness: any) {
  return {
    label,
    status: readiness.status,
    readyForExecution: readiness.readyForExecution,
    readyForEvidenceReview: readiness.readyForEvidenceReview,
    pendingManualEvidence: readiness.counts.pendingManualEvidence,
    externalInputs: readiness.externalInputs
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runManualPilotRehearsal();
  console.log("# Manual Pilot Rehearsal");
  console.log("");
  console.log("## Readiness Timeline");
  for (const point of result.readinessTimeline) {
    console.log(
      `- ${point.label}: ${point.status} (readyForExecution=${point.readyForExecution}, readyForEvidenceReview=${point.readyForEvidenceReview}, pendingManualEvidence=${point.pendingManualEvidence})`
    );
  }
  console.log("");
  console.log("## Machine Summary");
  console.log(
    JSON.stringify(
      {
        campaignId: result.campaignId,
        executionId: result.executionId,
        health: result.health,
        openApiPathCount: result.openApiPathCount,
        adapterRiskPosture: result.adapterRiskPosture,
        finalMetrics: result.finalMetrics,
        executionListCount: result.executionListCount,
        renewalDecision: result.renewalDecision
      },
      null,
      2
    )
  );
  console.log("");
  console.log(result.proofMarkdown);
}
