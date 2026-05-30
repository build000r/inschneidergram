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
        "/campaigns",
        "/campaigns/{id}/readiness",
        "/campaigns/{id}/approval-workbench",
        "/campaigns/{id}/approval-workbench/candidates/{candidateId}/claim",
        "/campaigns/{id}/approval-workbench/candidates/{candidateId}/work",
        "/campaigns/{id}/executions",
        "/campaigns/{id}/executions/{executionId}",
        "/campaigns/{id}/executions/{executionId}/manual-events",
        "/webhooks/preview"
      ])
    );
    expect(result.readinessTimeline.map((point) => point.status)).toEqual([
      "needs_approval",
      "ready_to_execute",
      "awaiting_manual_evidence",
      "evidence_ready"
    ]);
    expect(result.readinessTimeline.at(-1)).toMatchObject({
      readyForExecution: true,
      readyForEvidenceReview: true,
      pendingManualEvidence: 0
    });
    expect(result.readinessTimeline.at(-1)?.externalInputs).toEqual([]);
    expect(result.adapterRiskPosture).toMatchObject({
      kind: "manual",
      officialColdDmCompliance: "not_claimed",
      accountRiskOwner: "operator",
      requiresHumanEvidence: true
    });
    expect(result.finalMetrics).toMatchObject({
      contactedTargets: 1,
      sentMessages: 1,
      replies: 1,
      interestedReplies: 1,
      deliveryFailures: 1,
      webhookDelivered: 3,
      webhookDeadLetters: 0
    });
    expect(result.repeatedSentWebhookDelivery).toBeNull();
    expect(result.executionListCount).toBe(1);
    expect(result.persistedExecutionMetrics).toMatchObject({
      contactedTargets: 1,
      interestedReplies: 1,
      deliveryFailures: 1
    });
    expect(result.renewalDecision).toBe("renew");
    expect(result.proofMarkdown).toContain("Decision: renew");
  });
});
