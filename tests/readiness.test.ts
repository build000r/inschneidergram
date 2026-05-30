import { approveCandidate, approveMessage, createApprovalWorkbench } from "../src/domain/approval.js";
import { createCampaign } from "../src/domain/campaign.js";
import { createManualDeliveryAdapter } from "../src/domain/delivery.js";
import { executeApprovedCampaign } from "../src/domain/execution.js";
import { buildPilotReadinessReport } from "../src/domain/readiness.js";
import { createCampaignExecutionRecord } from "../src/domain/store.js";

function launchAuthorization() {
  return {
    actor: "graphed-approver",
    deliveryPath: "manual" as const,
    approvedTargetLimit: 2,
    approvedAt: "2026-05-30T01:00:00.000Z",
    expiresAt: "2026-06-06T01:00:00.000Z",
    reference: "launch-ticket-1",
    evidenceUrl: "https://docs.graphed.com/approvals/launch-ticket-1"
  };
}

describe("pilot readiness report", () => {
  it("requires launch authorization before classifying approved campaigns as ready to execute", () => {
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
      status: "needs_approval",
      readyForExecution: false,
      readyForEvidenceReview: false,
      counts: {
        acceptedTargets: 1,
        actionableApprovedTargets: 1,
        approvedCopy: 1,
        launchAuthorized: 0,
        executions: 0
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "launch_authorization",
          status: "fail"
        })
      ])
    });
    expect(report.externalInputs).toEqual(["permission to run the selected pilot delivery path"]);

    const authorizedReport = buildPilotReadinessReport({
      campaign,
      approvalWorkbench: workbench,
      executions: [],
      launchAuthorization: launchAuthorization()
    });

    expect(authorizedReport).toMatchObject({
      status: "ready_to_execute",
      readyForExecution: true,
      counts: {
        launchAuthorized: 1
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "launch_authorization",
          status: "pass"
        })
      ])
    });
    expect(authorizedReport.externalInputs).toEqual([]);
  });

  it("blocks required creator provenance until every accepted target is vetted", () => {
    const campaign = createCampaign({
      targets: [
        {
          target: "@vetted_creator",
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer"
        },
        "@unvetted_creator"
      ],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-vetting-pilot",
      settings: {
        requireTargetProvenance: true
      }
    });
    let workbench = createApprovalWorkbench({
      campaignId: campaign.id,
      candidates: [{ id: "candidate_1", target: "@vetted_creator" }],
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
      executions: [],
      launchAuthorization: launchAuthorization()
    });

    expect(report).toMatchObject({
      status: "ready_to_execute",
      readyForExecution: true,
      counts: {
        acceptedTargets: 1,
        vettedTargets: 1
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "creator_vetting",
          status: "pass"
        })
      ])
    });
    expect(report.externalInputs).toEqual([]);
  });

  it("passes optional creator vetting while still reporting vetted target counts", () => {
    const campaign = createCampaign({
      targets: [
        {
          target: "@vetted_creator",
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer"
        },
        "@unvetted_creator"
      ],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-optional-vetting-pilot"
    });

    const report = buildPilotReadinessReport({
      campaign,
      executions: []
    });

    expect(report).toMatchObject({
      counts: {
        acceptedTargets: 2,
        vettedTargets: 1
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "creator_vetting",
          status: "pass",
          detail: "1 target(s) include source and fit rationale; provenance is optional for this campaign."
        })
      ])
    });
  });

  it("fails readiness when strict legacy campaigns have accepted targets without provenance", () => {
    const campaign = createCampaign({
      targets: ["@unvetted_creator"],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-vetting-legacy-pilot"
    });
    const strictCampaign = {
      ...campaign,
      settings: {
        ...campaign.settings,
        requireTargetProvenance: true
      }
    };

    const report = buildPilotReadinessReport({
      campaign: strictCampaign,
      executions: []
    });

    expect(report).toMatchObject({
      status: "blocked",
      readyForExecution: false,
      counts: {
        acceptedTargets: 1,
        vettedTargets: 0
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "creator_vetting",
          status: "fail",
          nextAction: "Attach source and fit rationale to every accepted creator target."
        })
      ]),
      externalInputs: expect.arrayContaining(["creator provenance and fit rationale"])
    });
  });

  it("does not count skipped duplicate profile evidence as accepted creator vetting", () => {
    const campaign = createCampaign({
      targets: [
        "@same_creator",
        {
          target: "https://instagram.com/same_creator",
          source: "graphed-sheet:row-14",
          fitReason: "Strong audience match"
        }
      ],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-vetting-duplicate-pilot"
    });
    const strictCampaign = {
      ...campaign,
      settings: {
        ...campaign.settings,
        requireTargetProvenance: true
      }
    };

    const report = buildPilotReadinessReport({
      campaign: strictCampaign,
      executions: []
    });

    expect(report).toMatchObject({
      status: "blocked",
      counts: {
        acceptedTargets: 1,
        vettedTargets: 0
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "creator_vetting",
          status: "fail"
        })
      ])
    });
  });

  it("reports strict creator provenance as blocked when no vetted targets can be accepted", () => {
    const campaign = createCampaign({
      targets: ["@unvetted_creator"],
      message: "Open to an affiliate pilot?",
      campaign: "readiness-vetting-blocked-pilot",
      settings: {
        requireTargetProvenance: true
      }
    });

    const report = buildPilotReadinessReport({
      campaign,
      executions: []
    });

    expect(report).toMatchObject({
      status: "blocked",
      readyForExecution: false,
      counts: {
        acceptedTargets: 0,
        vettedTargets: 0
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "creator_vetting",
          status: "fail",
          nextAction: "Attach source and fit rationale to every accepted creator target."
        })
      ]),
      externalInputs: expect.arrayContaining([
        "vetted Instagram creator list",
        "creator provenance and fit rationale"
      ])
    });
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
      launchAuthorization: launchAuthorization(),
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
        launchAuthorization: launchAuthorization(),
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
