import {
  approveCandidate,
  approveMessage,
  blockCandidate,
  claimCandidate,
  createApprovalWorkbench,
  rejectCandidate,
  skipCandidate
} from "../src/domain/approval.js";
import { createCampaign, recordTargetEvent } from "../src/domain/campaign.js";
import {
  createMockDeliveryAdapter,
  createSendIntent,
  type DeliveryAttempt
} from "../src/domain/delivery.js";
import { generatePilotProofPack, type PilotIncident } from "../src/domain/proofPack.js";
import type { WebhookDeliveryRecord } from "../src/domain/outgoingWebhook.js";

describe("pilot proof pack", () => {
  it("generates the sample pilot metrics and markdown report", () => {
    let campaign = createCampaign(
      {
        targets: [
          "@creator_one",
          "@creator_two",
          "@creator_three",
          "@creator_four",
          "@creator_one",
          ".invalid"
        ],
        message: "Open to an affiliate pilot?",
        campaign: "graphed-pilot",
        metadata: { client: "graphed" },
        settings: {
          senderPool: ["sender-a", "sender-b"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              warmupNote: "ready for low-volume pilot",
              riskEvents: []
            },
            {
              id: "sender-b",
              status: "cooldown",
              dailyLimit: 10,
              cooldownUntil: "2026-05-30T03:00:00.000Z",
              riskEvents: [
                {
                  kind: "warning",
                  at: "2026-05-30T01:00:00.000Z",
                  note: "Temporary provider warning"
                }
              ]
            }
          ],
          webhookUrl: "https://example.com/webhooks/inschneidergram"
        }
      },
      new Date("2026-05-30T01:00:00.000Z")
    );
    campaign = recordTargetEvent(campaign, {
      target: "@creator_one",
      event: "sent",
      eventId: "evt_sent_1",
      messageId: "msg_1",
      receivedAt: "2026-05-30T01:10:00.000Z"
    });
    campaign = recordTargetEvent(campaign, {
      target: "@creator_two",
      event: "delivered",
      eventId: "evt_delivered_1",
      messageId: "msg_2",
      receivedAt: "2026-05-30T01:12:00.000Z"
    });
    campaign = recordTargetEvent(campaign, {
      target: "@creator_three",
      event: "reply",
      eventId: "evt_reply_1",
      messageId: "msg_3",
      receivedAt: "2026-05-30T01:20:00.000Z"
    });
    campaign = recordTargetEvent(campaign, {
      target: "@creator_four",
      event: "failed",
      eventId: "evt_failed_1",
      error: "Provider reported send failure",
      receivedAt: "2026-05-30T01:25:00.000Z"
    });

    let approval = createApprovalWorkbench(
      {
        campaignId: campaign.id,
        candidates: [
          { id: "creator_1", target: "@creator_one" },
          { id: "creator_2", target: "@creator_two" },
          { id: "creator_3", target: "@creator_three" },
          { id: "creator_4", target: "@creator_four" }
        ],
        messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
      },
      new Date("2026-05-30T01:00:00.000Z")
    );
    approval = approveCandidate(approval, { candidateId: "creator_1", actor: "approver" });
    approval = approveCandidate(approval, { candidateId: "creator_2", actor: "approver" });
    approval = approveCandidate(approval, { candidateId: "creator_3", actor: "approver" });
    approval = rejectCandidate(approval, {
      candidateId: "creator_4",
      actor: "approver",
      reason: "weak fit after review"
    });
    approval = approveMessage(approval, { messageId: "copy_1", actor: "approver" });

    const deliveryAttempts = sampleDeliveryAttempts(campaign.id);
    const webhookDeliveries = sampleWebhookDeliveries(campaign.id);
    const incidents: PilotIncident[] = [
      {
        kind: "opt_out",
        severity: "info",
        at: "2026-05-30T01:30:00.000Z",
        targetHandle: "creator_two",
        note: "Creator asked not to receive follow-up"
      },
      {
        kind: "manual_note",
        severity: "info",
        at: "2026-05-30T01:35:00.000Z",
        note: "Operator reviewed reply quality before renewal recommendation"
      }
    ];

    const proofPack = generatePilotProofPack({
      campaign,
      approvalWorkbench: approval,
      deliveryAttempts,
      webhookDeliveries,
      incidents,
      replyAssessments: [
        {
          targetHandle: "creator_three",
          disposition: "interested",
          qualified: true,
          replyText: "Interested - send details",
          note: "Qualified creator asked for the brief"
        }
      ],
      generatedAt: "2026-05-30T02:00:00.000Z"
    });

    expect(proofPack.metrics).toEqual({
      sourcedTargets: 6,
      acceptedTargets: 4,
      vettedTargets: 0,
      approvedTargets: 3,
      approvedCopy: 1,
      contactedTargets: 3,
      sentMessages: 3,
      deliveredMessages: 1,
      replies: 1,
      interestedReplies: 1,
      duplicateSkips: 1,
      blockedTargets: 1,
      operatorSkippedTargets: 0,
      operatorBlockedTargets: 0,
      optOuts: 1,
      complaints: 0,
      deliveryFailures: 1,
      senderWarnings: 1,
      webhookDelivered: 1,
      webhookDeadLetters: 1
    });
    expect(proofPack.renewalRecommendation).toMatchObject({
      decision: "renew"
    });
    expect(proofPack.markdown).toContain("| Interested replies | 1 |");
    expect(proofPack.markdown).toContain("| Vetted targets | 0 |");
    expect(proofPack.markdown).toContain("| Duplicate skips | 1 |");
    expect(proofPack.markdown).toContain("| Policy blocked targets | 1 |");
    expect(proofPack.markdown).toContain("| Operator skipped targets | 0 |");
    expect(proofPack.markdown).toContain("| Operator blocked targets | 0 |");
    expect(proofPack.markdown).toContain("Available senders: 1/2");
    expect(proofPack.markdown).toContain("Decision: renew");
  });

  it("reports operator skip and block evidence separately from policy blocks", () => {
    const campaign = createCampaign(
      {
        targets: ["@skip_creator", "@block_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "operator-proof-pilot"
      },
      new Date("2026-05-30T01:00:00.000Z")
    );
    let approval = createApprovalWorkbench(
      {
        campaignId: campaign.id,
        candidates: [
          { id: "skip_creator", target: "@skip_creator" },
          { id: "block_creator", target: "@block_creator" }
        ],
        messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
      },
      new Date("2026-05-30T01:01:00.000Z")
    );
    approval = approveCandidate(approval, { candidateId: "skip_creator", actor: "approver" });
    approval = approveCandidate(approval, { candidateId: "block_creator", actor: "approver" });
    approval = approveMessage(approval, { messageId: "copy_1", actor: "approver" });
    approval = claimCandidate(approval, { candidateId: "skip_creator", operator: "operator-a" });
    approval = skipCandidate(approval, {
      candidateId: "skip_creator",
      operator: "operator-a",
      reason: "duplicate found in Graphed source list",
      evidence: { source: "operator-review", reference: "sheet://row/41" }
    });
    approval = claimCandidate(approval, { candidateId: "block_creator", operator: "operator-a" });
    approval = blockCandidate(approval, {
      candidateId: "block_creator",
      operator: "operator-a",
      reason: "creator provenance could not be defended",
      evidence: { source: "operator-review", reference: "sheet://row/42" }
    });

    const proofPack = generatePilotProofPack({
      campaign,
      approvalWorkbench: approval,
      generatedAt: "2026-05-30T02:00:00.000Z"
    });

    expect(proofPack.metrics).toMatchObject({
      acceptedTargets: 2,
      approvedTargets: 2,
      blockedTargets: 0,
      operatorSkippedTargets: 1,
      operatorBlockedTargets: 1
    });
    expect(proofPack.markdown).toContain("| Policy blocked targets | 0 |");
    expect(proofPack.markdown).toContain("| Operator skipped targets | 1 |");
    expect(proofPack.markdown).toContain("| Operator blocked targets | 1 |");
  });

  it("counts vetted creator profiles in proof metrics", () => {
    const campaign = createCampaign(
      {
        targets: [
          {
            target: "@vetted_creator",
            source: "graphed-sheet:row-12",
            fitReason: "Audience overlaps the affiliate offer"
          },
          "@unvetted_creator"
        ],
        message: "Open to an affiliate pilot?",
        campaign: "profile-proof-pilot"
      },
      new Date("2026-05-30T01:00:00.000Z")
    );

    const proofPack = generatePilotProofPack({
      campaign,
      generatedAt: "2026-05-30T02:00:00.000Z"
    });

    expect(proofPack.metrics).toMatchObject({
      sourcedTargets: 2,
      acceptedTargets: 2,
      vettedTargets: 1
    });
    expect(proofPack.markdown).toContain("| Vetted targets | 1 |");
  });

  it("does not count skipped duplicate profile evidence as vetted proof", () => {
    const campaign = createCampaign(
      {
        targets: [
          "@same_creator",
          {
            target: "https://instagram.com/same_creator",
            source: "graphed-sheet:row-14",
            fitReason: "Strong audience match"
          }
        ],
        message: "Open to an affiliate pilot?",
        campaign: "profile-proof-duplicate-pilot"
      },
      new Date("2026-05-30T01:00:00.000Z")
    );

    const proofPack = generatePilotProofPack({
      campaign,
      generatedAt: "2026-05-30T02:00:00.000Z"
    });

    expect(proofPack.metrics).toMatchObject({
      acceptedTargets: 1,
      vettedTargets: 0
    });
    expect(proofPack.markdown).toContain("| Vetted targets | 0 |");
  });

  it("recommends stopping when complaints or critical incidents appear", () => {
    const campaign = createCampaign(
      {
        targets: ["@creator_one"],
        message: "Open to an affiliate pilot?",
        campaign: "risk-pilot"
      },
      new Date("2026-05-30T01:00:00.000Z")
    );

    const proofPack = generatePilotProofPack({
      campaign,
      replyAssessments: [
        {
          targetHandle: "creator_one",
          disposition: "complaint",
          qualified: false,
          note: "Creator complained about outreach"
        }
      ],
      incidents: [
        {
          kind: "sender_restriction",
          severity: "critical",
          at: "2026-05-30T01:05:00.000Z",
          senderAccountId: "sender-a",
          note: "Sender account restricted during pilot"
        }
      ],
      generatedAt: "2026-05-30T02:00:00.000Z"
    });

    expect(proofPack.renewalRecommendation).toEqual({
      decision: "stop",
      reasons: [
        "1 complaint(s) require remediation before renewal.",
        "Critical incident present in the pilot evidence."
      ]
    });
  });
});

function sampleDeliveryAttempts(campaignId: string): DeliveryAttempt[] {
  const adapter = createMockDeliveryAdapter({
    id: "proof_mock",
    failingTargets: ["creator_four"],
    replyTargets: ["creator_three"]
  });
  return ["creator_one", "creator_three", "creator_four"].map((target, index) =>
    adapter.deliver(
      createSendIntent(
        {
          id: `intent_${index + 1}`,
          campaignId,
          target,
          senderAccountId: "sender-a",
          message: "Open to an affiliate pilot?"
        },
        new Date("2026-05-30T01:05:00.000Z")
      ),
      new Date("2026-05-30T01:10:00.000Z")
    )
  );
}

function sampleWebhookDeliveries(campaignId: string): WebhookDeliveryRecord[] {
  return [
    {
      id: "webhook_delivered",
      url: "https://example.com/webhooks/inschneidergram",
      status: "delivered",
      nextAttemptAt: null,
      deliveredAt: "2026-05-30T01:11:00.000Z",
      attempts: [
        {
          attempt: 1,
          attemptedAt: "2026-05-30T01:11:00.000Z",
          success: true,
          statusCode: 204,
          retryable: false
        }
      ],
      payload: {
        id: "webhook_delivered",
        type: "target.sent",
        occurredAt: "2026-05-30T01:10:00.000Z",
        campaign: {
          id: campaignId,
          name: "graphed-pilot",
          status: "running",
          metadata: {},
          summary: {
            total: 6,
            scheduled: 0,
            sent: 1,
            delivered: 1,
            replied: 1,
            failed: 1,
            skippedDuplicate: 1,
            blockedPolicy: 1
          }
        },
        data: {}
      }
    },
    {
      id: "webhook_dead",
      url: "https://example.com/webhooks/inschneidergram",
      status: "dead_letter",
      nextAttemptAt: null,
      deadLetteredAt: "2026-05-30T01:12:00.000Z",
      lastError: "HTTP 500",
      attempts: [
        {
          attempt: 1,
          attemptedAt: "2026-05-30T01:12:00.000Z",
          success: false,
          statusCode: 500,
          retryable: true
        }
      ],
      payload: {
        id: "webhook_dead",
        type: "target.failed",
        occurredAt: "2026-05-30T01:12:00.000Z",
        campaign: {
          id: campaignId,
          name: "graphed-pilot",
          status: "running",
          metadata: {},
          summary: {
            total: 6,
            scheduled: 0,
            sent: 1,
            delivered: 1,
            replied: 1,
            failed: 1,
            skippedDuplicate: 1,
            blockedPolicy: 1
          }
        },
        data: {}
      }
    }
  ];
}
