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

  it("preserves vetted creator profile evidence on campaign targets", () => {
    const campaign = createCampaign({
      targets: [
        {
          target: "@vetted_creator",
          profileUrl: "https://instagram.com/vetted_creator",
          displayName: "Vetted Creator",
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer",
          tags: ["fitness", "affiliate"],
          followerCount: 24000,
          engagementRate: 4.2
        }
      ],
      message: "Open to an affiliate pilot?",
      campaign: "profile-intake-pilot"
    });

    expect(campaign.targets[0]).toMatchObject({
      raw: "@vetted_creator",
      handle: "vetted_creator",
      status: "scheduled",
      profile: {
        profileUrl: "https://instagram.com/vetted_creator",
        displayName: "Vetted Creator",
        source: "graphed-sheet:row-12",
        fitReason: "Audience overlaps the affiliate offer",
        tags: ["fitness", "affiliate"],
        followerCount: 24000,
        engagementRate: 4.2
      }
    });
  });

  it("deduplicates mixed string and profile targets by normalized handle", () => {
    const campaign = createCampaign({
      targets: [
        {
          target: "@dupe_creator",
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer"
        },
        "https://instagram.com/dupe_creator"
      ],
      message: "Open to an affiliate pilot?",
      campaign: "mixed-target-dedupe-pilot",
      settings: {
        requireTargetProvenance: true
      }
    });

    expect(campaign.summary).toMatchObject({
      total: 2,
      scheduled: 1,
      skippedDuplicate: 1,
      blockedPolicy: 0
    });
    expect(campaign.targets).toEqual([
      expect.objectContaining({
        handle: "dupe_creator",
        status: "scheduled",
        profile: expect.objectContaining({
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer"
        })
      }),
      expect.objectContaining({
        handle: "dupe_creator",
        status: "skipped_duplicate"
      })
    ]);
    expect(campaign.targets[1]?.profile).toBeUndefined();
  });

  it("can require creator provenance before scheduling targets", () => {
    const campaign = createCampaign({
      targets: [
        {
          target: "@vetted_creator",
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer"
        },
        "@unvetted_string_creator",
        {
          target: "@missing_fit_creator",
          source: "graphed-sheet:row-13"
        }
      ],
      message: "Open to an affiliate pilot?",
      campaign: "required-profile-intake-pilot",
      settings: {
        requireTargetProvenance: true
      }
    });

    expect(campaign.summary).toMatchObject({
      total: 3,
      scheduled: 1,
      blockedPolicy: 2
    });
    expect(campaign.targets.map((target) => [target.handle, target.status, target.error])).toEqual([
      ["vetted_creator", "scheduled", undefined],
      ["unvetted_string_creator", "blocked_policy", "Creator provenance and fit rationale required"],
      ["missing_fit_creator", "blocked_policy", "Creator provenance and fit rationale required"]
    ]);
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
