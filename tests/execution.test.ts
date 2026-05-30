import {
  approveCandidate,
  approveMessage,
  blockCandidate,
  claimCandidate,
  createApprovalWorkbench
} from "../src/domain/approval.js";
import { createCampaign } from "../src/domain/campaign.js";
import { createManagedProviderDeliveryAdapter } from "../src/domain/delivery.js";
import { executeApprovedCampaign } from "../src/domain/execution.js";
import { OutgoingWebhookDispatcher, type OutgoingWebhookRequest } from "../src/domain/outgoingWebhook.js";
import { verifyWebhookSignature } from "../src/domain/webhook.js";

describe("campaign execution runner", () => {
  it("runs approved targets through delivery, webhooks, and proof generation", async () => {
    const campaign = createCampaign(
      {
        targets: ["@creator_one", "@creator_two", "@creator_three", "@creator_four"],
        message: "Open to an affiliate pilot?",
        campaign: "execution-pilot",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram",
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      },
      new Date("2026-05-30T01:00:00.000Z")
    );
    let workbench = createApprovalWorkbench(
      {
        campaignId: campaign.id,
        candidates: [
          { id: "candidate_1", target: "@creator_one" },
          { id: "candidate_2", target: "@creator_two" },
          { id: "candidate_3", target: "@creator_three" }
        ],
        messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
      },
      new Date("2026-05-30T01:01:00.000Z")
    );
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_1",
      actor: "approver"
    });
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_2",
      actor: "approver"
    });
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_3",
      actor: "approver"
    });
    workbench = approveMessage(workbench, {
      messageId: "copy_1",
      actor: "approver"
    });

    const adapter = createManagedProviderDeliveryAdapter({
      id: "test_provider",
      deliver(intent) {
        if (intent.targetHandle === "creator_two") {
          return {
            outcome: "accepted",
            events: [
              {
                type: "sent",
                messageId: "provider_msg_2"
              },
              {
                type: "replied",
                messageId: "provider_msg_2",
                replyText: "Interested - send details"
              }
            ]
          };
        }

        if (intent.targetHandle === "creator_three") {
          return {
            outcome: "rejected",
            events: [
              {
                type: "restricted",
                reason: "sender cooldown"
              }
            ]
          };
        }

        return {
          outcome: "accepted",
          events: [
            {
              type: "sent",
              messageId: "provider_msg_1"
            }
          ]
        };
      }
    });
    const webhookRequests: OutgoingWebhookRequest[] = [];
    const dispatcher = new OutgoingWebhookDispatcher({
      secret: "execution-secret",
      async sender(request) {
        webhookRequests.push(request);
        return { statusCode: 204 };
      }
    });

    const result = await executeApprovedCampaign({
      campaign,
      workbench,
      adapter,
      webhookDispatcher: dispatcher,
      replyAssessments: [
        {
          targetHandle: "creator_two",
          disposition: "interested",
          qualified: true,
          replyText: "Interested - send details"
        }
      ],
      incidents: [
        {
          kind: "sender_warning",
          severity: "warning",
          at: "2026-05-30T01:20:00.000Z",
          senderAccountId: "sender-a",
          note: "Provider asked for cooldown after restricted result"
        }
      ],
      now: new Date("2026-05-30T01:15:00.000Z")
    });

    expect(result.intents.map((intent) => intent.targetHandle)).toEqual([
      "creator_one",
      "creator_two",
      "creator_three"
    ]);
    expect(result.campaign.summary).toMatchObject({
      total: 4,
      sent: 1,
      replied: 1,
      failed: 1,
      scheduled: 1
    });
    expect(result.deliveryAttempts.map((attempt) => attempt.adapterId)).toEqual([
      "test_provider",
      "test_provider",
      "test_provider"
    ]);
    expect(result.webhookDeliveries).toHaveLength(4);
    expect(webhookRequests).toHaveLength(4);
    expect(
      verifyWebhookSignature(
        webhookRequests[0]!.payload,
        "execution-secret",
        webhookRequests[0]!.headers["x-inschneidergram-signature"]!
      )
    ).toBe(true);
    expect(result.proofPack.metrics).toMatchObject({
      approvedTargets: 3,
      contactedTargets: 2,
      sentMessages: 2,
      replies: 1,
      interestedReplies: 1,
      deliveryFailures: 1,
      senderWarnings: 1,
      webhookDelivered: 4
    });
    expect(result.proofPack.markdown).toContain("Decision: renew");
  });

  it("refuses execution without approved copy", async () => {
    const campaign = createCampaign({
      targets: ["@creator_one"],
      message: "Open to an affiliate pilot?",
      campaign: "execution-pilot"
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

    await expect(
      executeApprovedCampaign({
        campaign,
        workbench,
        adapter: createManagedProviderDeliveryAdapter({
          deliver: () => ({ outcome: "accepted", events: [] })
        })
      })
    ).rejects.toThrow("Campaign execution requires approved message copy");
  });

  it("does not execute approved candidates that operators blocked", async () => {
    const campaign = createCampaign({
      targets: ["@creator_one", "@creator_two"],
      message: "Open to an affiliate pilot?",
      campaign: "operator-gated-pilot"
    });
    let workbench = createApprovalWorkbench({
      campaignId: campaign.id,
      candidates: [
        { id: "candidate_1", target: "@creator_one" },
        { id: "candidate_2", target: "@creator_two" }
      ],
      messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
    });
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_1",
      actor: "approver"
    });
    workbench = approveCandidate(workbench, {
      candidateId: "candidate_2",
      actor: "approver"
    });
    workbench = approveMessage(workbench, {
      messageId: "copy_1",
      actor: "approver"
    });
    workbench = claimCandidate(workbench, {
      candidateId: "candidate_2",
      operator: "operator-a"
    });
    workbench = blockCandidate(workbench, {
      candidateId: "candidate_2",
      operator: "operator-a",
      reason: "creator provenance could not be defended"
    });

    const result = await executeApprovedCampaign({
      campaign,
      workbench,
      adapter: createManagedProviderDeliveryAdapter({
        deliver: () => ({
          outcome: "accepted",
          events: [{ type: "sent" }]
        })
      })
    });

    expect(result.intents.map((intent) => intent.targetHandle)).toEqual(["creator_one"]);
    expect(result.proofPack.metrics).toMatchObject({
      approvedTargets: 2,
      contactedTargets: 1
    });
  });
});
