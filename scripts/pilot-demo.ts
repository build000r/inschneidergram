import {
  approveCandidate,
  approveMessage,
  createApprovalWorkbench
} from "../src/domain/approval.js";
import { createCampaign } from "../src/domain/campaign.js";
import { createMockDeliveryAdapter } from "../src/domain/delivery.js";
import { executeApprovedCampaign } from "../src/domain/execution.js";
import { OutgoingWebhookDispatcher } from "../src/domain/outgoingWebhook.js";

const now = new Date("2026-05-30T01:00:00.000Z");

const campaign = createCampaign(
  {
    targets: ["@demo_creator_one", "@demo_creator_two", "@demo_creator_three"],
    message: "Open to an affiliate pilot?",
    campaign: "local_pilot_demo",
    metadata: {
      source: "demo:pilot"
    },
    settings: {
      webhookUrl: "https://example.com/webhooks/inschneidergram",
      senderPool: ["sender-a"],
      senderAccounts: [
        {
          id: "sender-a",
          status: "healthy",
          dailyLimit: 20,
          warmupNote: "demo sender; no live Instagram delivery",
          riskEvents: []
        }
      ]
    }
  },
  now
);

let workbench = createApprovalWorkbench(
  {
    campaignId: campaign.id,
    candidates: [
      { id: "candidate_1", target: "@demo_creator_one" },
      { id: "candidate_2", target: "@demo_creator_two" },
      { id: "candidate_3", target: "@demo_creator_three" }
    ],
    messages: [{ id: "copy_1", body: "Open to an affiliate pilot?" }]
  },
  now
);

for (const candidate of workbench.candidates) {
  workbench = approveCandidate(workbench, {
    candidateId: candidate.id,
    actor: "demo-approver",
    reason: "Included in deterministic local pilot demo"
  });
}

workbench = approveMessage(workbench, {
  messageId: "copy_1",
  actor: "demo-approver",
  reason: "Demo-safe first-touch copy"
});

const webhookDispatcher = new OutgoingWebhookDispatcher({
  secret: "demo-secret",
  sender: async () => ({ statusCode: 204 })
});

const result = await executeApprovedCampaign({
  campaign,
  workbench,
  adapter: createMockDeliveryAdapter({
    replyTargets: ["@demo_creator_two"],
    failingTargets: ["@demo_creator_three"]
  }),
  webhookDispatcher,
  replyAssessments: [
    {
      targetHandle: "demo_creator_two",
      disposition: "interested",
      qualified: true,
      replyText: "Interested - send details",
      note: "Deterministic demo reply"
    }
  ],
  incidents: [
    {
      kind: "manual_note",
      severity: "info",
      at: "2026-05-30T01:20:00.000Z",
      note: "Local demo uses mock delivery and does not claim live Instagram sending"
    }
  ],
  now: new Date("2026-05-30T01:15:00.000Z")
});

console.log(result.proofPack.markdown);
console.log("## Machine Summary");
console.log(
  JSON.stringify(
    {
      status: result.campaign.status,
      summary: result.campaign.summary,
      adapterRiskPosture: result.deliveryAttempts[0]?.riskPosture,
      webhookDeliveries: result.webhookDeliveries.length,
      renewalRecommendation: result.proofPack.renewalRecommendation
    },
    null,
    2
  )
);
