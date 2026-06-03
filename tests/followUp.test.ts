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

  it("derives follow-up timing from the chronologically latest sent event across timezone offsets", () => {
    const campaign = createCampaign(
      {
        targets: ["@offset_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "follow-up-offset-pilot",
        settings: {
          followUps: [
            {
              delayHours: 24,
              message: "Circling back."
            }
          ]
        }
      },
      new Date("2026-06-03T00:00:00.000Z")
    );

    // Two "sent" events for the same target. The offset-bearing timestamp
    // (18:00Z) is chronologically earlier than the Z timestamp (19:00Z), but it
    // sorts *later* lexically. Such non-Z values can arrive from the persisted
    // store, which is re-read without re-validating the datetime format.
    const intent = {
      id: "intent_offset_1",
      campaignId: campaign.id,
      target: "offset_creator",
      targetHandle: "offset_creator",
      senderAccountId: "unassigned",
      message: "Open to an affiliate pilot?",
      scheduledAt: "2026-06-03T00:00:00.000Z",
      approvedAt: null,
      metadata: {}
    };
    const execution = createCampaignExecutionRecord(
      {
        campaignId: campaign.id,
        adapterRiskPosture: null,
        intents: [intent],
        deliveryAttempts: [
          {
            adapterId: "manual_delivery",
            outcome: "accepted",
            intent,
            events: [
              {
                id: "sent_z",
                intentId: intent.id,
                adapterId: "manual_delivery",
                type: "sent",
                occurredAt: "2026-06-03T19:00:00.000Z",
                evidence: {}
              },
              {
                id: "sent_offset",
                intentId: intent.id,
                adapterId: "manual_delivery",
                type: "sent",
                occurredAt: "2026-06-03T23:00:00.000+05:00",
                evidence: {}
              }
            ],
            requiredEvidence: [],
            riskPosture: {
              kind: "manual",
              officialColdDmCompliance: "not_claimed",
              accountRiskOwner: "operator",
              requiresHumanEvidence: true,
              posture: "human_operated",
              notes: []
            }
          }
        ],
        webhookDeliveries: [],
        proofPack: {
          generatedAt: "2026-06-03T19:00:00.000Z",
          campaignId: campaign.id,
          campaignName: campaign.campaign,
          metrics: {} as never,
          senderHealth: campaign.senderHealth,
          incidents: [],
          replies: [],
          renewalRecommendation: { decision: "iterate", reasons: [] },
          markdown: ""
        }
      },
      new Date("2026-06-03T19:00:00.000Z")
    );

    const plan = buildFollowUpPlan({
      campaign,
      executions: [execution],
      // 18:30Z is after the wrong base (18:00Z + 24h = next-day 18:00Z would be
      // "due") but before the correct base (19:00Z + 24h = next-day 19:00Z).
      generatedAt: "2026-06-04T18:30:00.000Z"
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.lastSentAt).toBe("2026-06-03T19:00:00.000Z");
    expect(plan.items[0]?.dueAt).toBe("2026-06-04T19:00:00.000Z");
    expect(plan.items[0]?.status).toBe("pending");
  });
});
