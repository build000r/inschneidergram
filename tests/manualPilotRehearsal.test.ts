import { readFile } from "node:fs/promises";
import { runManualPilotRehearsal } from "../scripts/manual-pilot-rehearsal.js";

describe("manual pilot rehearsal", () => {
  it("stays credential-free and in-process", async () => {
    const source = await readFile("scripts/manual-pilot-rehearsal.ts", "utf8");

    expect(source).not.toContain("fetch(");
    expect(source).not.toContain(".listen(");
    expect(source).not.toContain("JsonFileCampaignStore");
    expect(source).not.toContain("process.env");
  });

  it("runs the credential-free manual pilot path through evidence-ready proof", async () => {
    const result = await runManualPilotRehearsal();

    expect(result.health).toMatchObject({
      ok: true,
      service: "inschneidergram"
    });
    expect(result.openApiPaths).toEqual(
      expect.arrayContaining([
        "/health",
        "/senders",
        "/senders/{id}",
        "/senders/{id}/risk-events",
        "/operator/dashboard",
        "/operator/manual-queue",
        "/campaigns",
        "/campaigns/{id}/readiness",
        "/campaigns/{id}/follow-ups",
        "/campaigns/{id}/approval-workbench",
        "/campaigns/{id}/approval-workbench/candidates/{candidateId}/claim",
        "/campaigns/{id}/approval-workbench/candidates/{candidateId}/work",
        "/campaigns/{id}/executions",
        "/campaigns/{id}/executions/{executionId}",
        "/campaigns/{id}/executions/{executionId}/manual-queue",
        "/campaigns/{id}/executions/{executionId}/manual-events",
        "/webhooks/preview"
      ])
    );
    expect(result.readinessTimeline.map((point) => point.status)).toEqual([
      "needs_approval",
      "needs_approval",
      "awaiting_manual_evidence",
      "evidence_ready"
    ]);
    expect(result.readinessTimeline[1]).toMatchObject({
      label: "approved_and_claimed",
      readyForExecution: false,
      externalInputs: expect.arrayContaining(["permission to run the selected pilot delivery path"])
    });
    expect(result.readinessTimeline.at(-1)).toMatchObject({
      readyForExecution: true,
      readyForEvidenceReview: true,
      pendingManualEvidence: 0
    });
    expect(result.provenanceSummary).toEqual({
      requireTargetProvenance: true,
      sourcedTargets: 2,
      acceptedTargets: 2,
      vettedTargets: 2,
      externalInputs: []
    });
    expect(result.manualQueueTimeline).toEqual([
      {
        label: "manual_execution_created",
        pendingInitialEvidence: 2,
        replyMonitoring: 0,
        done: 0,
        items: 2
      },
      {
        label: "sent_recorded",
        pendingInitialEvidence: 1,
        replyMonitoring: 1,
        done: 0,
        items: 2
      },
      {
        label: "evidence_recorded",
        pendingInitialEvidence: 0,
        replyMonitoring: 0,
        done: 2,
        items: 2
      }
    ]);
    expect(result.readinessTimeline.at(-1)?.externalInputs).toEqual([]);
    expect(result.adapterRiskPosture).toMatchObject({
      kind: "manual",
      officialColdDmCompliance: "not_claimed",
      accountRiskOwner: "operator",
      requiresHumanEvidence: true
    });
    expect(result.finalMetrics).toMatchObject({
      sourcedTargets: 2,
      acceptedTargets: 2,
      vettedTargets: 2,
      contactedTargets: 1,
      sentMessages: 1,
      replies: 1,
      interestedReplies: 1,
      deliveryFailures: 1,
      senderWarnings: 1,
      webhookDelivered: 3,
      webhookDeadLetters: 0
    });
    expect(result.senderRiskSummary).toMatchObject({
      total: 2,
      available: 1,
      blocked: 1,
      restrictedSender: {
        id: "sender-b",
        status: "cooldown",
        available: false,
        blockers: ["cooldown"],
        riskEvents: [
          expect.objectContaining({
            kind: "restriction",
            note: "Manual restriction evidence for manual_demo_creator_two: Manual rehearsal restricted path"
          })
        ]
      }
    });
    expect(result.repeatedSentWebhookDelivery).toBeNull();
    expect(result.executionListCount).toBe(1);
    expect(result.persistedExecutionMetrics).toMatchObject({
      contactedTargets: 1,
      interestedReplies: 1,
      deliveryFailures: 1,
      senderWarnings: 1
    });
    expect(result.renewalDecision).toBe("iterate");
    expect(result.proofMarkdown).toContain("| Vetted targets | 2 |");
    expect(result.proofMarkdown).toContain("Decision: iterate");
  });
});
