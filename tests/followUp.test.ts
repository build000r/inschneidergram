import {
  approveCandidate,
  approveMessage,
  createApprovalWorkbench
} from "../src/domain/approval.js";
import { createCampaign } from "../src/domain/campaign.js";
import { createManagedProviderDeliveryAdapter } from "../src/domain/delivery.js";
import { executeApprovedCampaign } from "../src/domain/execution.js";
import { buildFollowUpPlan } from "../src/domain/followUp.js";
import { createCampaignExecutionRecord } from "../src/domain/store.js";

describe("follow-up planning", () => {
  it("returns an empty plan when a campaign has no follow-up rules", async () => {
    const campaign = createCampaign({
      targets: ["@creator_one"],
      message: "Open to an affiliate pilot?",
      campaign: "no-follow-up-pilot"
    });

    const plan = buildFollowUpPlan({
      campaign,
      executions: [],
      generatedAt: "2026-05-30T03:00:00.000Z"
    });

    expect(plan).toMatchObject({
      campaignId: campaign.id,
      latestExecutionId: null,
      followUpRules: [],
      counts: {
        total: 0,
        due: 0,
        pending: 0
      },
      items: []
    });
  });

  it("plans due and pending follow-ups only for contacted targets without terminal evidence", async () => {
    const campaign = createCampaign(
      {
        targets: [
          {
            target: "@needs_follow_up",
            source: "graphed-sheet:row-1",
            fitReason: "Strong audience match"
          },
          "@already_replied",
          "@restricted_creator"
        ],
        message: "Open to an affiliate pilot?",
        campaign: "follow-up-pilot",
        settings: {
          followUps: [
            {
              delayHours: 1,
              message: "Quick follow-up in case this got buried."
            },
            {
              delayHours: 72,
              message: "Last nudge before I close the loop."
            }
          ]
        }
      },
      new Date("2026-05-30T01:00:00.000Z")
    );
    let workbench = createApprovalWorkbench({
      campaignId: campaign.id,
      candidates: [
        { id: "candidate_1", target: "@needs_follow_up" },
        { id: "candidate_2", target: "@already_replied" },
        { id: "candidate_3", target: "@restricted_creator" }
      ],
      messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
    });
    for (const candidateId of ["candidate_1", "candidate_2", "candidate_3"]) {
      workbench = approveCandidate(workbench, { candidateId, actor: "approver" });
    }
    workbench = approveMessage(workbench, { messageId: "copy_1", actor: "approver" });

    const result = await executeApprovedCampaign({
      campaign,
      workbench,
      adapter: createManagedProviderDeliveryAdapter({
        id: "provider_contract",
        deliver(intent) {
          if (intent.targetHandle === "already_replied") {
            return {
              outcome: "accepted",
              events: [
                { type: "sent", occurredAt: "2026-05-30T01:05:00.000Z" },
                {
                  type: "replied",
                  occurredAt: "2026-05-30T01:30:00.000Z",
                  replyText: "Interested"
                }
              ]
            };
          }
          if (intent.targetHandle === "restricted_creator") {
            return {
              outcome: "rejected",
              events: [
                {
                  type: "restricted",
                  occurredAt: "2026-05-30T01:10:00.000Z",
                  reason: "sender cooldown"
                }
              ]
            };
          }
          return {
            outcome: "accepted",
            events: [{ type: "sent", occurredAt: "2026-05-30T01:05:00.000Z" }]
          };
        }
      }),
      now: new Date("2026-05-30T01:05:00.000Z")
    });
    const execution = createCampaignExecutionRecord(
      {
        campaignId: result.campaign.id,
        adapterRiskPosture: result.deliveryAttempts[0]?.riskPosture ?? null,
        intents: result.intents,
        deliveryAttempts: result.deliveryAttempts,
        webhookDeliveries: result.webhookDeliveries,
        approvalWorkbench: workbench,
        proofPack: result.proofPack
      },
      new Date("2026-05-30T01:06:00.000Z")
    );

    const plan = buildFollowUpPlan({
      campaign: result.campaign,
      executions: [execution],
      generatedAt: "2026-05-30T03:00:00.000Z"
    });

    expect(plan.counts).toEqual({
      total: 2,
      due: 1,
      pending: 1
    });
    expect(plan.items).toEqual([
      expect.objectContaining({
        targetHandle: "needs_follow_up",
        sequence: 1,
        message: "Quick follow-up in case this got buried.",
        dueAt: "2026-05-30T02:05:00.000Z",
        status: "due",
        profile: expect.objectContaining({
          source: "graphed-sheet:row-1",
          fitReason: "Strong audience match"
        })
      }),
      expect.objectContaining({
        targetHandle: "needs_follow_up",
        sequence: 2,
        message: "Last nudge before I close the loop.",
        dueAt: "2026-06-02T01:05:00.000Z",
        status: "pending"
      })
    ]);
    expect(plan.items.map((item) => item.targetHandle)).not.toContain("already_replied");
    expect(plan.items.map((item) => item.targetHandle)).not.toContain("restricted_creator");
  });
});
