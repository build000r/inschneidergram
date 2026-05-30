import { approveCandidate, approveMessage, createApprovalWorkbench } from "../src/domain/approval.js";
import { createCampaign } from "../src/domain/campaign.js";
import { createManualDeliveryAdapter } from "../src/domain/delivery.js";
import { executeApprovedCampaign } from "../src/domain/execution.js";
import { buildPilotReadinessReport } from "../src/domain/readiness.js";
import { createCampaignExecutionRecord } from "../src/domain/store.js";

describe("pilot readiness report", () => {
  it("classifies approved campaigns without execution as ready to execute", () => {
    const campaign = createCampaign({
      targets: ["@creator_one"],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-domain-pilot"
    });
    let workbench = createApprovalWorkbench({
      campaignId: campaign.id,
      candidates: [{ id: "candidate_1", target: "@creator_one" }],
      messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
    });
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_1",
      actor: "approver"
    });
    workbench = approveMessage(workbench, {
      messageId: "copy_1",
      actor: "approver"
    });

    const report = buildPilotReadinessReport({
      campaign,
      approvalWorkbench: workbench,
      executions: []
    });

    expect(report).toMatchObject({
      status: "ready_to_execute",
      readyForExecution: true,
      readyForEvidenceReview: false,
      counts: {
        acceptedTargets: 1,
        actionableApprovedTargets: 1,
        approvedCopy: 1,
        executions: 0
      }
    });
    expect(report.externalInputs).toEqual(["permission to run the selected pilot delivery path"]);
  });

  it("classifies manual executions without events as awaiting evidence", async () => {
    const campaign = createCampaign({
      targets: ["@creator_one"],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-manual-pilot"
    });
    let workbench = createApprovalWorkbench({
      campaignId: campaign.id,
      candidates: [{ id: "candidate_1", target: "@creator_one" }],
      messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
    });
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_1",
      actor: "approver"
    });
    workbench = approveMessage(workbench, {
      messageId: "copy_1",
      actor: "approver"
    });

    const execution = await executeApprovedCampaign({
      campaign,
      workbench,
      adapter: createManualDeliveryAdapter(),
      now: new Date("2026-05-30T01:00:00.000Z")
    });
    const executionRecord = createCampaignExecutionRecord(
      {
        campaignId: campaign.id,
        adapterRiskPosture: execution.deliveryAttempts[0]!.riskPosture,
        intents: execution.intents,
        deliveryAttempts: execution.deliveryAttempts,
        webhookDeliveries: execution.webhookDeliveries,
        approvalWorkbench: workbench,
        proofPack: execution.proofPack
      },
      new Date("2026-05-30T01:01:00.000Z")
    );

    const report = buildPilotReadinessReport({
      campaign: execution.campaign,
      approvalWorkbench: workbench,
      executions: [executionRecord]
    });

    expect(report).toMatchObject({
      status: "awaiting_manual_evidence",
      readyForExecution: true,
      readyForEvidenceReview: false,
      counts: {
        executions: 1,
        pendingManualEvidence: 1,
        contactedTargets: 0
      },
      externalInputs: ["operator delivery evidence"]
    });
  });
});
