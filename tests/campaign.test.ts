import { createCampaign, recordTargetEvent } from "../src/domain/campaign.js";
import { normalizeInstagramHandle } from "../src/domain/handles.js";
import { signWebhookPayload, verifyWebhookSignature } from "../src/domain/webhook.js";

describe("campaign domain", () => {
  it("normalizes supported Instagram target formats", () => {
    expect(normalizeInstagramHandle("@Creator.Name")).toBe("creator.name");
    expect(normalizeInstagramHandle("https://www.instagram.com/Creator_Name/?hl=en")).toBe(
      "creator_name"
    );
  });

  it("creates a safe scheduled campaign with duplicate prevention", () => {
    const campaign = createCampaign(
      {
        targets: ["@one_creator", "https://instagram.com/two.creator", "one_creator"],
        message: "Hey - open to an affiliate partnership?",
        campaign: "client_creator_outreach_may_2026",
        settings: {
          senderPool: ["sender-a", "sender-b"],
          dailyLimitPerSender: 1,
          minDelaySeconds: 60,
          maxDelaySeconds: 60
        }
      },
      new Date("2026-05-30T00:00:00.000Z")
    );

    expect(campaign.summary).toMatchObject({
      total: 3,
      scheduled: 2,
      skippedDuplicate: 1,
      blockedPolicy: 0
    });
    expect(campaign.targets[0]?.sender).toBe("sender-a");
    expect(campaign.targets[1]?.sender).toBe("sender-b");
    expect(campaign.targets[2]?.status).toBe("skipped_duplicate");
  });

  it("refuses unhealthy senders and reports sender health", () => {
    const campaign = createCampaign(
      {
        targets: ["@one_creator", "@two_creator"],
        message: "Hey - open to an affiliate partnership?",
        campaign: "sender_health_pilot",
        settings: {
          senderPool: ["sender-a", "sender-b"],
          dailyLimitPerSender: 35,
          senderAccounts: [
            {
              id: "sender-a",
              status: "cooldown",
              dailyLimit: 10,
              cooldownUntil: "2026-05-30T02:00:00.000Z",
              warmupNote: "cooling after warning",
              riskEvents: [
                {
                  kind: "warning",
                  at: "2026-05-30T00:30:00.000Z",
                  note: "Temporary send warning"
                }
              ]
            },
            {
              id: "sender-b",
              status: "reconnect_required",
              dailyLimit: 10,
              riskEvents: [
                {
                  kind: "reconnect_required",
                  at: "2026-05-30T00:45:00.000Z",
                  note: "Provider session expired"
                }
              ]
            }
          ]
        }
      },
      new Date("2026-05-30T01:00:00.000Z")
    );

    expect(campaign.status).toBe("failed");
    expect(campaign.summary).toMatchObject({
      scheduled: 0,
      blockedPolicy: 2
    });
    expect(campaign.targets.map((target) => target.error)).toEqual([
      "No healthy sender account available",
      "No healthy sender account available"
    ]);
    expect(campaign.senderHealth).toMatchObject({
      total: 2,
      available: 0,
      blocked: 2,
      accounts: [
        {
          id: "sender-a",
          available: false,
          blockers: ["cooldown_until:2026-05-30T02:00:00.000Z"]
        },
        {
          id: "sender-b",
          available: false,
          blockers: ["reconnect_required"]
        }
      ]
    });
  });

  it("records delivery and reply events idempotently", () => {
    const campaign = createCampaign({
      targets: ["@one_creator"],
      message: "Hey - open to an affiliate partnership?",
      campaign: "pilot"
    });

    const delivered = recordTargetEvent(campaign, {
      target: "one_creator",
      event: "delivered",
      eventId: "provider-event-1",
      messageId: "msg_123"
    });
    const replay = recordTargetEvent(delivered, {
      target: "one_creator",
      event: "delivered",
      eventId: "provider-event-1",
      messageId: "msg_123"
    });

    expect(replay.summary.delivered).toBe(1);
    expect(replay.targets[0]?.events).toHaveLength(1);
  });

  it("signs webhook payloads with stable canonical JSON", () => {
    const secret = "test-secret";
    const payload = { b: 2, a: { d: 4, c: 3 } };
    const signature = signWebhookPayload(payload, secret);

    expect(verifyWebhookSignature({ a: { c: 3, d: 4 }, b: 2 }, secret, signature)).toBe(
      true
    );
    expect(verifyWebhookSignature(payload, "wrong-secret", signature)).toBe(false);
  });
});
