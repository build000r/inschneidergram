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
  manualQueueTimeline: Array<{
    label: string;
    pendingInitialEvidence: number;
    replyMonitoring: number;
    done: number;
    items: number;
  }>;
  finalMetrics: {
    sourcedTargets: number;
    acceptedTargets: number;
    vettedTargets: number;
    contactedTargets: number;
    sentMessages: number;
    replies: number;
    interestedReplies: number;
    deliveryFailures: number;
    senderWarnings: number;
    webhookDelivered: number;
    webhookDeadLetters: number;
  };
  provenanceSummary: {
    requireTargetProvenance: boolean;
    sourcedTargets: number;
    acceptedTargets: number;
    vettedTargets: number;
    externalInputs: string[];
  };
  senderRiskSummary: {
    total: number;
    available: number;
    blocked: number;
    restrictedSender: {
      id: string;
      status: string;
      available: boolean;
      blockers: string[];
      riskEvents: Array<{
        kind: string;
        note: string;
      }>;
    } | null;
  };
  repeatedSentWebhookDelivery: unknown;
  executionListCount: number;
  persistedExecutionMetrics: {
    contactedTargets: number;
    interestedReplies: number;
    deliveryFailures: number;
    senderWarnings: number;
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
    await injectJson(app, "PUT", "/senders/sender-a", {
      status: "healthy",
      dailyLimit: 10,
      warmupNote: "manual rehearsal primary sender; no live Instagram delivery"
    });
    await injectJson(app, "PUT", "/senders/sender-b", {
      status: "healthy",
      dailyLimit: 10,
      warmupNote: "manual rehearsal backup sender; no live Instagram delivery"
    });
    const campaign = await injectJson(app, "POST", "/campaigns", {
      targets: [
        {
          target: "@manual_demo_creator_one",
          profileUrl: "https://www.instagram.com/manual_demo_creator_one/",
          displayName: "Manual Demo Creator One",
          source: "graphed-demo-sheet:row-1",
          fitReason: "Audience overlaps a low-volume affiliate pilot",
          tags: ["creator", "affiliate", "demo"],
          followerCount: 18_500,
          engagementRate: 4.8
        },
        {
          target: "@manual_demo_creator_two",
          profileUrl: "https://www.instagram.com/manual_demo_creator_two/",
          displayName: "Manual Demo Creator Two",
          source: "graphed-demo-sheet:row-2",
          fitReason: "Content niche matches the campaign offer",
          tags: ["creator", "fitness", "demo"],
          followerCount: 24_200,
          engagementRate: 3.9
        }
      ],
      message: "Open to a short affiliate pilot with Graphed?",
      campaign: "manual_pilot_rehearsal",
      metadata: {
        source: "demo:manual-pilot",
        client: "graphed"
      },
      settings: {
        webhookUrl: "https://example.com/webhooks/inschneidergram",
        senderPool: ["sender-a", "sender-b"],
        minDelaySeconds: 90,
        maxDelaySeconds: 420,
        requireTargetProvenance: true
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

    const authorizationApprovedAt = new Date();
    const authorizationExpiresAt = new Date(
      authorizationApprovedAt.getTime() + 7 * 24 * 60 * 60 * 1000
    );
    const execution = await injectJson(app, "POST", `/campaigns/${campaign.campaignId}/executions`, {
      adapter: { kind: "manual" },
      launchAuthorization: {
        actor: "demo-approver",
        deliveryPath: "manual",
        approvedTargetLimit: 2,
        approvedAt: authorizationApprovedAt.toISOString(),
        expiresAt: authorizationExpiresAt.toISOString(),
        reference: "manual-demo-launch-approval",
        evidenceUrl: "https://docs.graphed.com/approvals/manual-demo-launch-approval",
        notes: "Credential-free local rehearsal authorization; no live Instagram delivery."
      }
    });
    const adapterRiskPosture = execution.adapterRiskPosture;
    const manualQueueTimeline = [
      manualQueuePoint(
        "manual_execution_created",
        await injectJson(app, "GET", `/operator/manual-queue?campaignId=${campaign.campaignId}`)
      )
    ];
    readinessTimeline.push(
      readinessPoint(
        "manual_execution_created",
        await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/readiness`)
      )
    );

    const sentPayload = {
      target: "@manual_demo_creator_one",
      type: "sent",
      occurredAt: "2026-05-30T01:15:00.000Z",
      messageId: "manual_msg_1",
      simulateWebhookDelivery: true,
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
    manualQueueTimeline.push(
      manualQueuePoint(
        "sent_recorded",
        await injectJson(
          app,
          "GET",
          `/operator/manual-queue?campaignId=${campaign.campaignId}&status=all`
        )
      )
    );
    await injectJson(
      app,
      "POST",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}/manual-events`,
      {
        eventId: "manual-rehearsal-reply-1",
        target: "@manual_demo_creator_one",
        type: "replied",
        occurredAt: "2026-05-30T01:45:00.000Z",
        messageId: "manual_msg_1",
        replyText: "Interested - send the brief",
        simulateWebhookDelivery: true,
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
        occurredAt: "2026-05-30T01:50:00.000Z",
        reason: "Manual rehearsal restricted path",
        simulateWebhookDelivery: true,
        evidence: {
          operatorId: "demo-operator",
          screenshotUrl: "s3://proof/manual-rehearsal-restricted.png",
          restrictionSource: "manual-rehearsal"
        }
      }
    );
    const finalReadiness = await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/readiness`);
    readinessTimeline.push(readinessPoint("evidence_recorded", finalReadiness));
    manualQueueTimeline.push(
      manualQueuePoint(
        "evidence_recorded",
        await injectJson(
          app,
          "GET",
          `/operator/manual-queue?campaignId=${campaign.campaignId}&status=all`
        )
      )
    );
    const executionList = await injectJson(app, "GET", `/campaigns/${campaign.campaignId}/executions`);
    const persistedExecution = await injectJson(
      app,
      "GET",
      `/campaigns/${campaign.campaignId}/executions/${execution.executionId}`
    );
    const senderInventory = await injectJson(app, "GET", "/senders");
    const restrictedSender = senderInventory.senderHealth.accounts.find(
      (account: any) => account.id === "sender-b"
    );

    return {
      campaignId: campaign.campaignId,
      executionId: execution.executionId,
      health,
      openApiPathCount: openApiPaths.length,
      openApiPaths,
      adapterRiskPosture,
      readinessTimeline,
      manualQueueTimeline,
      finalMetrics: {
        sourcedTargets: finalEvidence.proofPack.metrics.sourcedTargets,
        acceptedTargets: finalEvidence.proofPack.metrics.acceptedTargets,
        vettedTargets: finalEvidence.proofPack.metrics.vettedTargets,
        contactedTargets: finalEvidence.proofPack.metrics.contactedTargets,
        sentMessages: finalEvidence.proofPack.metrics.sentMessages,
        replies: finalEvidence.proofPack.metrics.replies,
        interestedReplies: finalEvidence.proofPack.metrics.interestedReplies,
        deliveryFailures: finalEvidence.proofPack.metrics.deliveryFailures,
        senderWarnings: finalEvidence.proofPack.metrics.senderWarnings,
        webhookDelivered: finalEvidence.proofPack.metrics.webhookDelivered,
        webhookDeadLetters: finalEvidence.proofPack.metrics.webhookDeadLetters
      },
      provenanceSummary: {
        requireTargetProvenance: true,
        sourcedTargets: finalReadiness.counts.sourcedTargets,
        acceptedTargets: finalReadiness.counts.acceptedTargets,
        vettedTargets: finalReadiness.counts.vettedTargets,
        externalInputs: finalReadiness.externalInputs
      },
      senderRiskSummary: {
        total: senderInventory.senderHealth.total,
        available: senderInventory.senderHealth.available,
        blocked: senderInventory.senderHealth.blocked,
        restrictedSender: restrictedSender
          ? {
              id: restrictedSender.id,
              status: restrictedSender.status,
              available: restrictedSender.available,
              blockers: restrictedSender.blockers,
              riskEvents: restrictedSender.riskEvents.map((event: any) => ({
                kind: event.kind,
                note: event.note
              }))
            }
          : null
      },
      repeatedSentWebhookDelivery: repeatedSent.webhookDelivery,
      executionListCount: executionList.executions.length,
      persistedExecutionMetrics: {
        contactedTargets: persistedExecution.proofPack.metrics.contactedTargets,
        interestedReplies: persistedExecution.proofPack.metrics.interestedReplies,
        deliveryFailures: persistedExecution.proofPack.metrics.deliveryFailures,
        senderWarnings: persistedExecution.proofPack.metrics.senderWarnings
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
  method: "GET" | "POST" | "PUT",
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

function manualQueuePoint(label: string, queue: any) {
  return {
    label,
    pendingInitialEvidence: queue.counts.pendingInitialEvidence,
    replyMonitoring: queue.counts.replyMonitoring,
    done: queue.counts.done,
    items: queue.items.length
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
  console.log("## Manual Queue Timeline");
  for (const point of result.manualQueueTimeline) {
    console.log(
      `- ${point.label}: pending=${point.pendingInitialEvidence}, replyMonitoring=${point.replyMonitoring}, done=${point.done}, returnedItems=${point.items}`
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
        manualQueueTimeline: result.manualQueueTimeline,
        finalMetrics: result.finalMetrics,
        provenanceSummary: result.provenanceSummary,
        senderRiskSummary: result.senderRiskSummary,
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
