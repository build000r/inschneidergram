import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { approveCandidate, approveMessage, createApprovalWorkbench } from "../src/domain/approval.js";
import { createCampaign } from "../src/domain/campaign.js";
import { generatePilotProofPack } from "../src/domain/proofPack.js";
import { createSenderAccount } from "../src/domain/sender.js";
import {
  createCampaignExecutionRecord,
  InMemoryCampaignStore,
  JsonFileCampaignStore
} from "../src/domain/store.js";

describe("campaign stores", () => {
  it("deduplicates inserts by idempotency key in memory", async () => {
    const store = new InMemoryCampaignStore();
    const first = await store.insert(
      createCampaign({
        idempotencyKey: "pilot-key-1",
        targets: ["creator_one"],
        message: "Hey",
        campaign: "pilot"
      })
    );
    const second = await store.insert(
      createCampaign({
        idempotencyKey: "pilot-key-1",
        targets: ["creator_two"],
        message: "Different message",
        campaign: "pilot"
      })
    );

    expect(second.id).toBe(first.id);
    expect(second.targets[0]?.handle).toBe("creator_one");
  });

  it("suppresses previously scheduled handles across campaigns", async () => {
    const store = new InMemoryCampaignStore();
    const first = await store.insert(
      createCampaign({
        targets: ["creator_one"],
        message: "Hey",
        campaign: "pilot-a"
      })
    );
    const second = await store.insert(
      createCampaign({
        targets: ["creator_one", "creator_two"],
        message: "Hey again",
        campaign: "pilot-b"
      })
    );

    expect(second.targets.map((target) => [target.handle, target.status])).toEqual([
      ["creator_one", "skipped_duplicate"],
      ["creator_two", "scheduled"]
    ]);
    expect(await store.listSuppressions()).toEqual([
      expect.objectContaining({ handle: "creator_one", campaignId: first.id }),
      expect.objectContaining({ handle: "creator_two", campaignId: second.id })
    ]);
  });

  it("persists sender inventory and appends risk events atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inschneidergram-senders-"));
    const storePath = join(dir, "campaigns.json");

    try {
      const firstStore = new JsonFileCampaignStore(storePath);
      await firstStore.upsertSenderAccount(
        createSenderAccount({
          id: "sender-a",
          status: "healthy",
          dailyLimit: 25,
          riskEvents: [
            {
              kind: "manual_note",
              at: "2026-05-30T00:00:00.000Z",
              note: "Warm-up started"
            }
          ]
        })
      );

      const secondStore = new JsonFileCampaignStore(storePath);
      const updated = await secondStore.appendSenderRiskEvent(
        "sender-a",
        {
          kind: "lockout",
          note: "Login checkpoint"
        },
        new Date("2026-05-30T01:00:00.000Z")
      );

      expect(updated).toMatchObject({
        id: "sender-a",
        status: "locked",
        riskEvents: [
          { kind: "manual_note", note: "Warm-up started" },
          {
            kind: "lockout",
            at: "2026-05-30T01:00:00.000Z",
            note: "Login checkpoint"
          }
        ]
      });

      const thirdStore = new JsonFileCampaignStore(storePath);
      expect(await thirdStore.listSenderAccounts()).toEqual([
        expect.objectContaining({
          id: "sender-a",
          status: "locked",
          riskEvents: expect.arrayContaining([
            expect.objectContaining({ kind: "manual_note" }),
            expect.objectContaining({ kind: "lockout" })
          ])
        })
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists campaigns across JsonFileCampaignStore instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inschneidergram-store-"));
    const storePath = join(dir, "campaigns.json");

    try {
      const firstStore = new JsonFileCampaignStore(storePath);
      const campaign = await firstStore.insert(
        createCampaign({
          idempotencyKey: "pilot-key-2",
          targets: ["creator_one"],
          message: "Hey",
          campaign: "pilot"
        })
      );

      const secondStore = new JsonFileCampaignStore(storePath);
      const loaded = await secondStore.get(campaign.id);
      const replay = await secondStore.insert(
        createCampaign({
          idempotencyKey: "pilot-key-2",
          targets: ["creator_two"],
          message: "Different message",
          campaign: "pilot"
        })
      );

      expect(loaded?.id).toBe(campaign.id);
      expect(replay.id).toBe(campaign.id);
      expect(await secondStore.list()).toHaveLength(1);

      const crossCampaign = await secondStore.insert(
        createCampaign({
          targets: ["creator_one", "creator_three"],
          message: "Fresh campaign",
          campaign: "pilot-follow-up"
        })
      );
      const thirdStore = new JsonFileCampaignStore(storePath);

      expect(crossCampaign.targets.map((target) => [target.handle, target.status])).toEqual([
        ["creator_one", "skipped_duplicate"],
        ["creator_three", "scheduled"]
      ]);
      expect(await thirdStore.listSuppressions()).toEqual([
        expect.objectContaining({ handle: "creator_one", campaignId: campaign.id }),
        expect.objectContaining({ handle: "creator_three", campaignId: crossCampaign.id })
      ]);

      let workbench = createApprovalWorkbench({
        campaignId: campaign.id,
        candidates: [{ id: "candidate_1", target: "creator_one" }],
        messages: [{ id: "copy_1", body: "Hey" }]
      });
      workbench = approveCandidate(workbench, {
        candidateId: "candidate_1",
        actor: "approver"
      });
      workbench = approveMessage(workbench, {
        messageId: "copy_1",
        actor: "approver"
      });
      await thirdStore.upsertApprovalWorkbench(workbench);
      const approvalStore = new JsonFileCampaignStore(storePath);

      expect(await approvalStore.getApprovalWorkbench(campaign.id)).toMatchObject({
        campaignId: campaign.id,
        summary: {
          candidates: {
            approved: 1
          },
          messages: {
            approved: 1
          }
        }
      });

      const execution = createCampaignExecutionRecord(
        {
          campaignId: campaign.id,
          adapterRiskPosture: null,
          intents: [],
          deliveryAttempts: [],
          webhookDeliveries: [],
          proofPack: generatePilotProofPack({
            campaign,
            generatedAt: "2026-05-30T01:00:00.000Z"
          })
        },
        new Date("2026-05-30T01:01:00.000Z")
      );
      await thirdStore.insertExecution(execution);
      const fourthStore = new JsonFileCampaignStore(storePath);

      expect(await fourthStore.getExecution(execution.id)).toMatchObject({
        id: execution.id,
        campaignId: campaign.id,
        proofPack: {
          campaignId: campaign.id,
          metrics: {
            sourcedTargets: 1
          }
        }
      });
      expect(await fourthStore.listExecutions(campaign.id)).toEqual([
        expect.objectContaining({ id: execution.id, campaignId: campaign.id })
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
