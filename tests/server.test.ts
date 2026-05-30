import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { createCampaign } from "../src/domain/campaign.js";
import { InMemoryCampaignStore, JsonFileCampaignStore } from "../src/domain/store.js";
import type { OutgoingWebhookRequest } from "../src/domain/outgoingWebhook.js";
import { verifyWebhookSignature } from "../src/domain/webhook.js";

describe("API", () => {
  it("accepts campaign creation through POST /campaigns", async () => {
    const app = await buildServer({ webhookSecret: "test-secret" });

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1", "instagram_profile_2"],
        message: "Hey - loved your content. Open to an affiliate partnership?",
        campaign: "client_creator_outreach_may_2026"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "queued",
      summary: {
        total: 2,
        scheduled: 2
      }
    });

    await app.close();
  });

  it("accepts vetted creator profile objects in campaign creation", async () => {
    const app = await buildServer({ webhookSecret: "test-secret" });

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: [
          {
            target: "@vetted_creator",
            profileUrl: "https://instagram.com/vetted_creator",
            displayName: "Vetted Creator",
            source: "graphed-sheet:row-12",
            fitReason: "Audience overlaps the affiliate offer",
            tags: ["fitness"],
            followerCount: 24000,
            engagementRate: 4.2
          }
        ],
        message: "Hey - loved your content. Open to an affiliate partnership?",
        campaign: "creator_profile_intake_pilot",
        settings: {
          requireTargetProvenance: true
        }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "queued",
      summary: {
        total: 1,
        scheduled: 1,
        blockedPolicy: 0
      },
      targets: [
        {
          handle: "vetted_creator",
          profile: {
            source: "graphed-sheet:row-12",
            fitReason: "Audience overlaps the affiliate offer",
            tags: ["fitness"]
          }
        }
      ]
    });

    await app.close();
  });

  it("preserves mixed string and creator profile targets through campaign fetch", async () => {
    const app = await buildServer({ webhookSecret: "test-secret" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: [
          {
            target: "@profile_creator",
            source: "graphed-sheet:row-21",
            fitReason: "Strong audience match"
          },
          "@string_creator"
        ],
        message: "Hey - loved your content. Open to an affiliate partnership?",
        campaign: "mixed_creator_profile_intake"
      }
    });
    expect(createResponse.statusCode).toBe(202);
    expect(createResponse.json()).toMatchObject({
      summary: {
        scheduled: 2
      },
      targets: [
        {
          handle: "profile_creator",
          profile: {
            source: "graphed-sheet:row-21",
            fitReason: "Strong audience match"
          }
        },
        {
          handle: "string_creator",
          status: "scheduled"
        }
      ]
    });

    const fetchResponse = await app.inject({
      method: "GET",
      url: `/campaigns/${createResponse.json().campaignId}`
    });
    expect(fetchResponse.statusCode).toBe(200);
    expect(fetchResponse.json().targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handle: "profile_creator",
          profile: expect.objectContaining({
            source: "graphed-sheet:row-21",
            fitReason: "Strong audience match"
          })
        }),
        expect.objectContaining({
          handle: "string_creator"
        })
      ])
    );
    expect(
      fetchResponse.json().targets.find((target: { handle: string }) => target.handle === "string_creator")
        .profile
    ).toBeUndefined();

    await app.close();
  });

  it("updates campaign status from provider events", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1"],
        message: "Hey - loved your content.",
        campaign: "pilot"
      }
    });
    const campaignId = createResponse.json().campaignId;

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/events`,
      payload: {
        target: "instagram_profile_1",
        event: "reply",
        eventId: "evt_1"
      }
    });

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json()).toMatchObject({
      status: "completed",
      summary: {
        replied: 1
      }
    });

    await app.close();
  });

  it("dispatches signed webhooks from provider event ingestion", async () => {
    const webhookRequests: OutgoingWebhookRequest[] = [];
    const app = await buildServer({
      webhookSecret: "event-webhook-secret",
      async webhookSender(request) {
        webhookRequests.push(request);
        return { statusCode: 202 };
      }
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@webhook_event_creator"],
        message: "Hey - loved your content.",
        campaign: "provider-event-webhook",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram"
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/events`,
      payload: {
        target: "@webhook_event_creator",
        event: "reply",
        eventId: "evt_provider_reply",
        messageId: "msg_provider_reply"
      }
    });

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json()).toMatchObject({
      status: "completed",
      webhookDelivery: {
        id: "evt_provider_reply",
        status: "delivered",
        attempts: [expect.objectContaining({ statusCode: 202, success: true })]
      }
    });
    expect(webhookRequests).toHaveLength(1);
    expect(webhookRequests[0]).toMatchObject({
      url: "https://example.com/webhooks/inschneidergram",
      payload: {
        id: "evt_provider_reply",
        type: "target.replied",
        target: {
          handle: "webhook_event_creator",
          messageId: "msg_provider_reply"
        }
      }
    });
    expect(
      verifyWebhookSignature(
        webhookRequests[0]!.payload,
        "event-webhook-secret",
        webhookRequests[0]!.headers["x-inschneidergram-signature"]!
      )
    ).toBe(true);

    const duplicate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/events`,
      payload: {
        target: "@webhook_event_creator",
        event: "reply",
        eventId: "evt_provider_reply",
        messageId: "msg_provider_reply"
      }
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().webhookDelivery).toBeNull();
    expect(webhookRequests).toHaveLength(1);

    await app.close();
  });

  it("records webhook dead letters and replays them from operator routes", async () => {
    const webhookRequests: OutgoingWebhookRequest[] = [];
    let acceptReplay = false;
    const app = await buildServer({
      webhookSecret: "dead-letter-secret",
      async webhookSender(request) {
        webhookRequests.push(request);
        return { statusCode: acceptReplay ? 204 : 400 };
      }
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@dead_letter_creator"],
        message: "Hey - loved your content.",
        campaign: "dead-letter-webhook",
        settings: {
          webhookUrl: "https://example.com/webhooks/dead-letter"
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/events`,
      payload: {
        target: "@dead_letter_creator",
        event: "failed",
        eventId: "evt_dead_letter",
        error: "provider rejected callback"
      }
    });
    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json().webhookDelivery).toMatchObject({
      id: "evt_dead_letter",
      status: "dead_letter",
      lastError: "HTTP 400"
    });

    const deadLetters = await app.inject({
      method: "GET",
      url: "/webhooks/dead-letters"
    });
    expect(deadLetters.statusCode).toBe(200);
    expect(deadLetters.json().deadLetters).toEqual([
      expect.objectContaining({ id: "evt_dead_letter", status: "dead_letter" })
    ]);

    acceptReplay = true;
    const replay = await app.inject({
      method: "POST",
      url: "/webhooks/dead-letters/evt_dead_letter/replay"
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().delivery).toMatchObject({
      id: "evt_dead_letter",
      status: "delivered",
      deliveredAt: expect.any(String)
    });
    expect(webhookRequests).toHaveLength(2);

    await app.close();
  });

  it("does not dispatch provider event webhooks when no webhook URL is configured", async () => {
    const webhookRequests: OutgoingWebhookRequest[] = [];
    const app = await buildServer({
      async webhookSender(request) {
        webhookRequests.push(request);
        return { statusCode: 204 };
      }
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@no_webhook_creator"],
        message: "Hey - loved your content.",
        campaign: "no-webhook-event"
      }
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${createResponse.json().campaignId}/events`,
      payload: {
        target: "@no_webhook_creator",
        event: "sent",
        eventId: "evt_no_webhook"
      }
    });

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json()).toMatchObject({
      status: "running",
      webhookDelivery: null
    });
    expect(webhookRequests).toEqual([]);

    await app.close();
  });

  it.each([
    ["non-https", "http://example.com/webhooks/inschneidergram", "Webhook URL must use https"],
    ["localhost", "https://localhost/webhooks/inschneidergram", "Webhook URL host localhost is not allowed"],
    ["loopback", "https://127.0.0.1/webhooks/inschneidergram", "Webhook URL host 127.0.0.1 is not allowed"],
    ["private network", "https://10.0.0.1/webhooks/inschneidergram", "Webhook URL host 10.0.0.1 is not allowed"],
    [
      "link-local metadata",
      "https://169.254.169.254/latest/meta-data",
      "Webhook URL host 169.254.169.254 is not allowed"
    ],
    ["ipv6 loopback", "https://[::1]/webhooks/inschneidergram", "Webhook URL host ::1 is not allowed"]
  ])(
    "rejects unsafe campaign webhook destinations: %s",
    async (_label, webhookUrl, message) => {
      const app = await buildServer();

      const response = await app.inject({
        method: "POST",
        url: "/campaigns",
        payload: {
          targets: ["@unsafe_webhook_creator"],
          message: "Hey - loved your content.",
          campaign: "unsafe-webhook",
          settings: { webhookUrl }
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "invalid_request",
        message
      });

      await app.close();
    }
  );

  it("enforces configured webhook host allowlists", async () => {
    const app = await buildServer({
      webhookAllowedHosts: ["hooks.graphed.test", "*.tenant-hooks.graphed.test"]
    });

    const exactHost = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@exact_hook_creator"],
        message: "Hey - loved your content.",
        campaign: "exact-webhook-allowlist",
        settings: {
          webhookUrl: "https://hooks.graphed.test/events"
        }
      }
    });
    expect(exactHost.statusCode).toBe(202);

    const wildcardSubdomain = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@wildcard_hook_creator"],
        message: "Hey - loved your content.",
        campaign: "wildcard-webhook-allowlist",
        settings: {
          webhookUrl: "https://client-a.tenant-hooks.graphed.test/events"
        }
      }
    });
    expect(wildcardSubdomain.statusCode).toBe(202);

    const wildcardApex = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@apex_hook_creator"],
        message: "Hey - loved your content.",
        campaign: "apex-webhook-allowlist",
        settings: {
          webhookUrl: "https://tenant-hooks.graphed.test/events"
        }
      }
    });
    expect(wildcardApex.statusCode).toBe(400);
    expect(wildcardApex.json().message).toBe(
      "Webhook URL host tenant-hooks.graphed.test is not in INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS"
    );

    const unrelatedHost = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@unrelated_hook_creator"],
        message: "Hey - loved your content.",
        campaign: "unrelated-webhook-allowlist",
        settings: {
          webhookUrl: "https://evil.test/events"
        }
      }
    });
    expect(unrelatedHost.statusCode).toBe(400);
    expect(unrelatedHost.json().message).toBe(
      "Webhook URL host evil.test is not in INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS"
    );

    await app.close();
  });

  it("dead-letters blocked legacy webhook destinations without invoking the sender", async () => {
    const store = new InMemoryCampaignStore();
    const campaign = await store.insert(
      createCampaign({
        targets: ["@legacy_webhook_creator"],
        message: "Hey - loved your content.",
        campaign: "legacy-blocked-webhook",
        settings: {
          webhookUrl: "https://127.0.0.1/webhooks/legacy"
        }
      })
    );
    const webhookRequests: OutgoingWebhookRequest[] = [];
    const app = await buildServer({
      store,
      async webhookSender(request) {
        webhookRequests.push(request);
        return { statusCode: 204 };
      }
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaign.id}/events`,
      payload: {
        target: "@legacy_webhook_creator",
        event: "reply",
        eventId: "evt_legacy_blocked",
        messageId: "msg_legacy_blocked"
      }
    });

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json().webhookDelivery).toMatchObject({
      id: "evt_legacy_blocked",
      status: "dead_letter",
      attempts: [
        expect.objectContaining({
          statusCode: 400,
          success: false,
          retryable: false
        })
      ]
    });
    expect(webhookRequests).toEqual([]);

    const replay = await app.inject({
      method: "POST",
      url: "/webhooks/dead-letters/evt_legacy_blocked/replay"
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().delivery).toMatchObject({
      id: "evt_legacy_blocked",
      status: "dead_letter",
      attempts: [
        expect.objectContaining({ statusCode: 400, retryable: false }),
        expect.objectContaining({ statusCode: 400, retryable: false })
      ]
    });
    expect(webhookRequests).toEqual([]);

    await app.close();
  });

  it("dead-letters webhook hostnames that resolve to private addresses", async () => {
    const store = new InMemoryCampaignStore();
    const campaign = await store.insert(
      createCampaign({
        targets: ["@dns_blocked_creator"],
        message: "Hey - loved your content.",
        campaign: "dns-blocked-webhook",
        settings: {
          webhookUrl: "https://callback.example.com/webhooks/dns-blocked"
        }
      })
    );
    const webhookRequests: OutgoingWebhookRequest[] = [];
    const app = await buildServer({
      store,
      webhookDnsLookup: async () => [{ address: "10.0.0.8", family: 4 }],
      async webhookSender(request) {
        webhookRequests.push(request);
        return { statusCode: 204 };
      }
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaign.id}/events`,
      payload: {
        target: "@dns_blocked_creator",
        event: "reply",
        eventId: "evt_dns_blocked"
      }
    });

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json().webhookDelivery).toMatchObject({
      id: "evt_dns_blocked",
      status: "dead_letter",
      attempts: [
        expect.objectContaining({
          statusCode: 400,
          retryable: false
        })
      ]
    });
    expect(webhookRequests).toEqual([]);

    await app.close();
  });

  it("returns validation errors for invalid campaigns", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: [],
        campaign: "missing_message"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");

    await app.close();
  });

  it("reports unhealthy JSON store paths from /health", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inschneidergram-health-"));
    const notDirectory = join(dir, "not-directory");
    await writeFile(notDirectory, "not a directory", "utf8");
    const app = await buildServer({
      store: new JsonFileCampaignStore(join(notDirectory, "campaigns.json")),
      provider: "health-test"
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health"
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        ok: false,
        service: "inschneidergram",
        provider: "health-test",
        store: {
          ok: false,
          kind: "json_file"
        }
      });
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("protects API routes when an API key is configured", async () => {
    const app = await buildServer({
      apiKey: "deploy-secret",
      webhookSecret: "preview-secret"
    });

    try {
      const health = await app.inject({
        method: "GET",
        url: "/health"
      });
      expect(health.statusCode).toBe(200);

      const openapi = await app.inject({
        method: "GET",
        url: "/openapi.json"
      });
      expect(openapi.statusCode).toBe(200);

      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/campaigns",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,x-api-key,content-type"
        }
      });
      expect(preflight.statusCode).not.toBe(401);
      expect(String(preflight.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain(
        "x-api-key"
      );

      const missing = await app.inject({
        method: "GET",
        url: "/campaigns"
      });
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({
        error: "unauthorized",
        message: "Valid API key required"
      });

      const wrong = await app.inject({
        method: "GET",
        url: "/campaigns",
        headers: {
          "x-api-key": "wrong-secret"
        }
      });
      expect(wrong.statusCode).toBe(401);

      const xApiKey = await app.inject({
        method: "GET",
        url: "/campaigns",
        headers: {
          "x-api-key": "deploy-secret"
        }
      });
      expect(xApiKey.statusCode).toBe(200);

      const bearer = await app.inject({
        method: "GET",
        url: "/campaigns",
        headers: {
          authorization: "Bearer deploy-secret"
        }
      });
      expect(bearer.statusCode).toBe(200);

      const previewWithoutAuth = await app.inject({
        method: "POST",
        url: "/webhooks/preview",
        payload: { ok: true }
      });
      expect(previewWithoutAuth.statusCode).toBe(401);

      const previewWithAuth = await app.inject({
        method: "POST",
        url: "/webhooks/preview",
        headers: {
          "x-api-key": "deploy-secret"
        },
        payload: { ok: true }
      });
      expect(previewWithAuth.statusCode).toBe(200);
      expect(previewWithAuth.json()).toMatchObject({
        payload: { ok: true },
        signature: expect.any(String)
      });
    } finally {
      await app.close();
    }
  });

  it("honors idempotency-key headers for campaign creation", async () => {
    const app = await buildServer();
    const payload = {
      targets: ["instagram_profile_1"],
      message: "Hey - loved your content.",
      campaign: "pilot"
    };

    const first = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: {
        "idempotency-key": "pilot-idempotency-key"
      },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: {
        "idempotency-key": "pilot-idempotency-key"
      },
      payload: {
        ...payload,
        targets: ["instagram_profile_2"]
      }
    });

    expect(second.statusCode).toBe(202);
    expect(second.json().campaignId).toBe(first.json().campaignId);
    expect(second.json().targets[0].handle).toBe("instagram_profile_1");

    await app.close();
  });

  it("suppresses duplicate handles from earlier campaigns", async () => {
    const app = await buildServer();

    await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1"],
        message: "Hey - loved your content.",
        campaign: "pilot-a"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1", "instagram_profile_2"],
        message: "Fresh campaign",
        campaign: "pilot-b"
      }
    });

    expect(second.statusCode).toBe(202);
    expect(second.json().targets.map((target: { status: string }) => target.status)).toEqual([
      "skipped_duplicate",
      "scheduled"
    ]);

    await app.close();
  });

  it("returns sender health when account state blocks scheduling", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1"],
        message: "Hey - loved your content.",
        campaign: "sender-health",
        settings: {
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "locked",
              dailyLimit: 5,
              riskEvents: [
                {
                  kind: "lockout",
                  at: "2026-05-30T00:00:00.000Z",
                  note: "Login checkpoint"
                }
              ]
            }
          ]
        }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "failed",
      summary: {
        blockedPolicy: 1
      },
      senderHealth: {
        total: 1,
        available: 0,
        blocked: 1,
        accounts: [
          {
            id: "sender-a",
            status: "locked",
            available: false,
            blockers: ["locked"]
          }
        ]
      }
    });

    await app.close();
  });

  it("manages stored sender inventory and uses it for campaign scheduling", async () => {
    const app = await buildServer();

    const upsert = await app.inject({
      method: "PUT",
      url: "/senders/sender-a",
      payload: {
        dailyLimit: 20,
        warmupNote: "day 4 warm-up"
      }
    });
    expect(upsert.statusCode).toBe(200);
    expect(upsert.json()).toMatchObject({
      senderAccount: {
        id: "sender-a",
        status: "healthy",
        dailyLimit: 20,
        warmupNote: "day 4 warm-up",
        riskEvents: []
      },
      senderHealth: {
        total: 1,
        available: 1
      }
    });

    const fetched = await app.inject({
      method: "GET",
      url: "/senders/sender-a"
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().senderAccount.id).toBe("sender-a");

    const listed = await app.inject({
      method: "GET",
      url: "/senders"
    });
    expect(listed.json()).toMatchObject({
      senderAccounts: [expect.objectContaining({ id: "sender-a" })],
      senderHealth: {
        total: 1,
        available: 1
      }
    });

    const create = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@stored_sender_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "stored-sender-pilot",
        settings: {
          senderPool: ["sender-a"]
        }
      }
    });
    expect(create.statusCode).toBe(202);
    expect(create.json()).toMatchObject({
      status: "queued",
      targets: [
        {
          handle: "stored_sender_creator",
          status: "scheduled",
          sender: "sender-a"
        }
      ],
      senderHealth: {
        available: 1
      }
    });

    const unknownSender = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@unknown_sender_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "unknown-sender-pilot",
        settings: {
          senderPool: ["sender-missing"]
        }
      }
    });
    expect(unknownSender.statusCode).toBe(400);
    expect(unknownSender.json()).toMatchObject({
      error: "invalid_request",
      message: "Unknown managed sender account(s): sender-missing"
    });

    const riskEvent = await app.inject({
      method: "POST",
      url: "/senders/sender-a/risk-events",
      payload: {
        kind: "lockout",
        note: "Login checkpoint"
      }
    });
    expect(riskEvent.statusCode).toBe(200);
    expect(riskEvent.json()).toMatchObject({
      senderAccount: {
        id: "sender-a",
        status: "locked",
        warmupNote: "day 4 warm-up",
        riskEvents: [expect.objectContaining({ kind: "lockout", note: "Login checkpoint" })]
      },
      senderHealth: {
        available: 0,
        blocked: 1
      }
    });

    const blockedCreate = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@blocked_stored_sender_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "blocked-stored-sender-pilot",
        settings: {
          senderPool: ["sender-a"]
        }
      }
    });
    expect(blockedCreate.statusCode).toBe(202);
    expect(blockedCreate.json()).toMatchObject({
      status: "failed",
      summary: {
        blockedPolicy: 1
      },
      senderHealth: {
        available: 0,
        blocked: 1,
        accounts: [
          {
            id: "sender-a",
            status: "locked",
            blockers: ["locked"]
          }
        ]
      }
    });

    await app.close();
  });

  it("rechecks managed sender health before readiness and execution", async () => {
    const app = await buildServer();

    await app.inject({
      method: "PUT",
      url: "/senders/sender-a",
      payload: {
        dailyLimit: 20
      }
    });
    const create = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@post_creation_lock_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "post-creation-lock",
        settings: {
          senderPool: ["sender-a"]
        }
      }
    });
    const campaignId = create.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@post_creation_lock_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });

    await app.inject({
      method: "POST",
      url: "/senders/sender-a/risk-events",
      payload: {
        kind: "lockout",
        note: "Login checkpoint after scheduling"
      }
    });

    const readiness = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      status: "blocked",
      readyForExecution: false,
      counts: {
        availableSenders: 0
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "sender_health",
          status: "fail",
          detail: "0/1 sender account(s) available."
        })
      ])
    });

    const execution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`
    });
    expect(execution.statusCode).toBe(409);
    expect(execution.json()).toMatchObject({
      error: "conflict"
    });
    expect(execution.json().message).toContain("blocked");
    expect(execution.json().message).toContain("Sender health");

    await app.close();
  });

  it("rejects execution while approval readiness gates are still missing", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@unapproved_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "unapproved-execution",
        settings: {
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    const readiness = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(readiness.json()).toMatchObject({
      status: "needs_approval",
      readyForExecution: false
    });

    const execution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "mock" }
      }
    });
    expect(execution.statusCode).toBe(409);
    expect(execution.json()).toMatchObject({
      error: "conflict"
    });
    expect(execution.json().message).toContain("needs_approval");
    expect(execution.json().message).toContain("Approval workbench");

    const executions = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions`
    });
    expect(executions.json().executions).toEqual([]);

    await app.close();
  });

  it("uses the runtime webhook sender for non-simulated executions", async () => {
    const webhookRequests: OutgoingWebhookRequest[] = [];
    const app = await buildServer({
      webhookSecret: "runtime-execution-secret",
      webhookAllowedHosts: ["example.com"],
      async webhookSender(request) {
        webhookRequests.push(request);
        return { statusCode: 204 };
      }
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@runtime_execution_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "runtime-execution-webhook",
        settings: {
          webhookUrl: "https://example.com/webhooks/runtime-execution",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@runtime_execution_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });
    const execution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        simulateWebhooks: false,
        adapter: {
          kind: "mock",
          replyTargets: ["@runtime_execution_creator"]
        }
      }
    });

    expect(execution.statusCode).toBe(200);
    expect(execution.json().webhookDeliveries).toEqual([
      expect.objectContaining({
        status: "delivered",
        attempts: [expect.objectContaining({ statusCode: 204 })]
      }),
      expect.objectContaining({
        status: "delivered",
        attempts: [expect.objectContaining({ statusCode: 204 })]
      })
    ]);
    expect(webhookRequests.map((request) => request.payload.type)).toEqual([
      "target.sent",
      "target.replied"
    ]);

    await app.close();
  });

  it("persists approval workbench decisions and executes stored approvals", async () => {
    const app = await buildServer({ webhookSecret: "approval-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@approved_creator", "@rejected_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "approval-api-pilot",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    const createdWorkbench = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approveMessage: false
      }
    });
    expect(createdWorkbench.statusCode).toBe(200);
    expect(createdWorkbench.json().approvalWorkbench).toMatchObject({
      campaignId,
      summary: {
        candidates: {
          total: 2,
          pending: 2
        },
        messages: {
          pending: 1
        }
      }
    });

    const candidateIds = Object.fromEntries(
      createdWorkbench
        .json()
        .approvalWorkbench.candidates.map((candidate: { id: string; handle: string }) => [
          candidate.handle,
          candidate.id
        ])
    );
    const copyId = createdWorkbench.json().approvalWorkbench.messages[0].id;

    const approvedCandidate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.approved_creator}/decision`,
      payload: {
        decision: "approved",
        actor: "approver",
        reason: "strong fit"
      }
    });
    expect(approvedCandidate.statusCode).toBe(200);

    const rejectedCandidate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.rejected_creator}/decision`,
      payload: {
        decision: "rejected",
        actor: "approver",
        reason: "weak fit"
      }
    });
    expect(rejectedCandidate.statusCode).toBe(200);

    const approvedMessage = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/messages/${copyId}/decision`,
      payload: {
        decision: "approved",
        actor: "approver",
        reason: "brand safe"
      }
    });
    expect(approvedMessage.statusCode).toBe(200);
    expect(approvedMessage.json().approvalWorkbench.summary).toMatchObject({
      candidates: {
        approved: 1,
        rejected: 1,
        blocked: 1
      },
      messages: {
        approved: 1
      }
    });

    const storedWorkbench = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/approval-workbench`
    });
    expect(storedWorkbench.json().approvalWorkbench.audit.map(
      (entry: { action: string }) => entry.action
    )).toEqual([
      "workbench_created",
      "candidate_approved",
      "candidate_rejected",
      "message_approved"
    ]);

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "mock",
          replyTargets: ["@approved_creator"]
        }
      }
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json()).toMatchObject({
      summary: {
        scheduled: 1,
        replied: 1
      },
      proofPack: {
        metrics: {
          approvedTargets: 1,
          approvedCopy: 1,
          contactedTargets: 1,
          replies: 1,
          operatorBlockedTargets: 0
        }
      }
    });
    expect(
      executionResponse.json().intents.map((intent: { targetHandle: string }) => intent.targetHandle)
    ).toEqual(["approved_creator"]);
    expect(executionResponse.json().execution.approvalWorkbench.summary).toMatchObject({
      candidates: {
        approved: 1,
        rejected: 1
      }
    });

    await app.close();
  });

  it("persists operator work state and excludes skipped candidates from execution", async () => {
    const app = await buildServer({ webhookSecret: "operator-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@send_creator", "@skip_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "operator-workbench-pilot",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    const createdWorkbench = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@send_creator", "@skip_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });
    const candidateIds = Object.fromEntries(
      createdWorkbench
        .json()
        .approvalWorkbench.candidates.map((candidate: { id: string; handle: string }) => [
          candidate.handle,
          candidate.id
        ])
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.skip_creator}/claim`,
      payload: {
        operator: "operator-a"
      }
    });
    expect(claimResponse.statusCode).toBe(200);
    expect(claimResponse.json().approvalWorkbench.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidateIds.skip_creator,
          work: "claimed",
          claimedBy: "operator-a"
        })
      ])
    );

    const skipResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.skip_creator}/work`,
      payload: {
        work: "skipped",
        operator: "operator-a",
        reason: "duplicate found in external sheet",
        evidence: {
          source: "operator-review",
          reference: "sheet://row/42"
        }
      }
    });
    expect(skipResponse.statusCode).toBe(200);
    expect(skipResponse.json().approvalWorkbench.summary.candidates).toMatchObject({
      approved: 2,
      skipped: 1
    });

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "mock",
          replyTargets: ["@send_creator"]
        }
      }
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(
      executionResponse.json().intents.map((intent: { targetHandle: string }) => intent.targetHandle)
    ).toEqual(["send_creator"]);
    expect(executionResponse.json()).toMatchObject({
      summary: {
        scheduled: 1,
        replied: 1
      },
      proofPack: {
        metrics: {
          approvedTargets: 2,
          contactedTargets: 1,
          replies: 1,
          operatorSkippedTargets: 1,
          operatorBlockedTargets: 0
        }
      }
    });
    expect(executionResponse.json().execution.approvalWorkbench.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidateIds.skip_creator,
          work: "skipped",
          reason: "duplicate found in external sheet"
        })
      ])
    );

    await app.close();
  });

  it("reports pilot launch readiness across approval, manual execution, and proof", async () => {
    const app = await buildServer({ webhookSecret: "readiness-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@ready_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "readiness-pilot",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    const initialReadiness = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(initialReadiness.statusCode).toBe(200);
    expect(initialReadiness.json()).toMatchObject({
      status: "needs_approval",
      readyForExecution: false,
      counts: {
        acceptedTargets: 1,
        availableSenders: 1,
        approvedTargets: 0,
        actionableApprovedTargets: 0,
        approvedCopy: 0
      },
      externalInputs: expect.arrayContaining([
        "creator approval decision",
        "approved first-touch copy",
        "permission to run the selected pilot delivery path"
      ])
    });

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@ready_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });

    const approvedReadiness = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(approvedReadiness.json()).toMatchObject({
      status: "ready_to_execute",
      readyForExecution: true,
      readyForEvidenceReview: false,
      counts: {
        approvedTargets: 1,
        actionableApprovedTargets: 1,
        approvedCopy: 1,
        executions: 0
      }
    });

    const manualExecution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "manual" }
      }
    });
    const executionId = manualExecution.json().executionId;

    const awaitingEvidence = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(awaitingEvidence.json()).toMatchObject({
      status: "awaiting_manual_evidence",
      readyForExecution: true,
      readyForEvidenceReview: false,
      counts: {
        executions: 1,
        pendingManualEvidence: 1,
        contactedTargets: 0
      },
      externalInputs: expect.arrayContaining(["operator delivery evidence"])
    });

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      headers: {
        "idempotency-key": "readiness-sent-1"
      },
      payload: {
        target: "@ready_creator",
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/ready_creator",
          screenshotUrl: "s3://proof/readiness-sent.png"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "readiness-reply-1",
        target: "@ready_creator",
        type: "replied",
        messageId: "manual_msg_1",
        replyText: "Interested - send details",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/ready_creator",
          screenshotUrl: "s3://proof/readiness-reply.png",
          replyCapturedAt: "2026-05-30T01:45:00.000Z"
        },
        replyAssessment: {
          disposition: "interested",
          qualified: true,
          note: "Qualified creator asked for the brief"
        }
      }
    });

    const evidenceReady = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(evidenceReady.json()).toMatchObject({
      status: "evidence_ready",
      readyForExecution: true,
      readyForEvidenceReview: true,
      counts: {
        pendingManualEvidence: 0,
        contactedTargets: 1,
        interestedReplies: 1
      },
      externalInputs: []
    });

    await app.close();
  });

  it("exposes an operator manual delivery queue across evidence states", async () => {
    const app = await buildServer({ webhookSecret: "queue-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@queue_creator_one", "@queue_creator_two"],
        message: "Open to an affiliate pilot?",
        campaign: "manual-queue-pilot",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@queue_creator_one", "@queue_creator_two"],
        approveMessage: true,
        actor: "approver"
      }
    });
    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "manual" }
      }
    });
    const executionId = executionResponse.json().executionId;

    const pendingQueue = await app.inject({
      method: "GET",
      url: "/operator/manual-queue"
    });
    expect(pendingQueue.statusCode).toBe(200);
    expect(pendingQueue.json()).toMatchObject({
      counts: {
        total: 2,
        pendingInitialEvidence: 2,
        replyMonitoring: 0,
        done: 0
      },
      items: [
        expect.objectContaining({
          status: "pending_initial_evidence",
          campaignId,
          campaignName: "manual-queue-pilot",
          executionId,
          targetHandle: "queue_creator_one",
          allowedManualEvents: ["sent", "failed", "restricted"],
          requiredEvidenceByEvent: {
            sent: ["operatorId", "conversationUrl", "screenshotUrl"],
            failed: ["operatorId"],
            restricted: ["operatorId", "screenshotUrl", "restrictionSource"]
          },
          manualEventsUrl: `/campaigns/${campaignId}/executions/${executionId}/manual-events`
        }),
        expect.objectContaining({
          targetHandle: "queue_creator_two"
        })
      ]
    });

    const executionQueue = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-queue`
    });
    expect(executionQueue.statusCode).toBe(200);
    expect(executionQueue.json()).toMatchObject({
      campaignId,
      campaignName: "manual-queue-pilot",
      executionId,
      counts: {
        pendingInitialEvidence: 2
      }
    });

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "queue-sent-1",
        target: "@queue_creator_one",
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/queue_creator_one",
          screenshotUrl: "s3://proof/queue-sent.png"
        }
      }
    });

    const afterSentDefaultQueue = await app.inject({
      method: "GET",
      url: "/operator/manual-queue"
    });
    expect(afterSentDefaultQueue.json()).toMatchObject({
      counts: {
        total: 2,
        pendingInitialEvidence: 1,
        replyMonitoring: 1,
        done: 0
      },
      items: [expect.objectContaining({ targetHandle: "queue_creator_two" })]
    });

    const replyMonitoringQueue = await app.inject({
      method: "GET",
      url: "/operator/manual-queue?status=reply_monitoring"
    });
    expect(replyMonitoringQueue.json().items).toEqual([
      expect.objectContaining({
        targetHandle: "queue_creator_one",
        status: "reply_monitoring",
        allowedManualEvents: ["replied"],
        requiredEvidenceByEvent: {
          replied: ["operatorId", "conversationUrl", "screenshotUrl", "replyCapturedAt"]
        },
        latestEvent: expect.objectContaining({ type: "sent" })
      })
    ]);

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "queue-replied-1",
        target: "@queue_creator_one",
        type: "replied",
        messageId: "manual_msg_1",
        replyText: "Interested - send details",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/queue_creator_one",
          screenshotUrl: "s3://proof/queue-reply.png",
          replyCapturedAt: "2026-05-30T01:45:00.000Z"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "queue-restricted-1",
        target: "@queue_creator_two",
        type: "restricted",
        reason: "Manual queue restricted path",
        evidence: {
          operatorId: "op_1",
          screenshotUrl: "s3://proof/queue-restricted.png",
          restrictionSource: "manual-queue-test"
        }
      }
    });

    const allQueue = await app.inject({
      method: "GET",
      url: "/operator/manual-queue?status=all"
    });
    expect(allQueue.json()).toMatchObject({
      counts: {
        total: 2,
        pendingInitialEvidence: 0,
        replyMonitoring: 0,
        done: 2
      },
      items: [
        expect.objectContaining({
          targetHandle: "queue_creator_one",
          status: "done",
          latestEvent: expect.objectContaining({ type: "replied" })
        }),
        expect.objectContaining({
          targetHandle: "queue_creator_two",
          status: "done",
          latestEvent: expect.objectContaining({ type: "restricted" })
        })
      ]
    });

    await app.close();
  });

  it("executes approved targets through managed provider outcomes", async () => {
    const app = await buildServer({ webhookSecret: "provider-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@provider_sent", "@provider_reply", "@provider_restricted"],
        message: "Open to an affiliate pilot?",
        campaign: "managed-provider-pilot",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram",
          senderPool: ["sender-a"],
          followUps: [
            {
              delayHours: 168,
              message: "Checking back once before I close the loop."
            }
          ],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@provider_sent", "@provider_reply", "@provider_restricted"],
        approveMessage: true,
        actor: "approver"
      }
    });

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "managed_provider",
          id: "provider_contract",
          accountRiskOwner: "provider",
          notes: ["Provider-reported contract test, not live Instagram delivery."],
          outcomes: [
            {
              target: "@provider_sent",
              outcome: "accepted",
              events: [
                {
                  type: "sent",
                  messageId: "provider_msg_1",
                  evidence: { providerRunId: "run_1" }
                }
              ]
            },
            {
              target: "@provider_reply",
              outcome: "accepted",
              events: [
                {
                  type: "sent",
                  messageId: "provider_msg_2",
                  evidence: { providerRunId: "run_1" }
                },
                {
                  type: "replied",
                  messageId: "provider_msg_2",
                  replyText: "Interested - send details",
                  evidence: { providerRunId: "run_1", providerReplyId: "reply_1" }
                }
              ]
            },
            {
              target: "@provider_restricted",
              outcome: "rejected",
              events: [
                {
                  type: "restricted",
                  reason: "Provider reported sender cooldown",
                  evidence: { providerRunId: "run_1", providerAttemptId: "attempt_3" }
                }
              ]
            }
          ]
        },
        replyAssessments: [
          {
            targetHandle: "@provider_reply",
            disposition: "interested",
            qualified: true,
            replyText: "Interested - send details"
          }
        ]
      }
    });

    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json()).toMatchObject({
      status: "running",
      summary: {
        sent: 1,
        replied: 1,
        failed: 1
      },
      adapterRiskPosture: {
        kind: "managed_provider",
        officialColdDmCompliance: "not_claimed",
        accountRiskOwner: "provider",
        posture: "provider_operated"
      },
      proofPack: {
        metrics: {
          contactedTargets: 2,
          sentMessages: 2,
          replies: 1,
          interestedReplies: 1,
          deliveryFailures: 1,
          webhookDelivered: 4
        }
      }
    });
    expect(
      executionResponse
        .json()
        .deliveryAttempts.map((attempt: { adapterId: string; events: Array<{ type: string }> }) => [
          attempt.adapterId,
          attempt.events.map((event) => event.type)
        ])
    ).toEqual([
      ["provider_contract", ["sent"]],
      ["provider_contract", ["sent", "replied"]],
      ["provider_contract", ["restricted"]]
    ]);

    const storedExecution = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions/${executionResponse.json().executionId}`
    });
    expect(storedExecution.json()).toMatchObject({
      adapterRiskPosture: {
        kind: "managed_provider"
      },
      proofPack: {
        metrics: {
          contactedTargets: 2,
          interestedReplies: 1
        }
      }
    });

    const readiness = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(readiness.json()).toMatchObject({
      status: "evidence_ready",
      readyForEvidenceReview: true,
      counts: {
        executions: 1,
        pendingManualEvidence: 0,
        contactedTargets: 2,
        interestedReplies: 1
      }
    });

    const proofExport = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/proof-pack`
    });
    expect(proofExport.statusCode).toBe(200);
    expect(proofExport.json()).toMatchObject({
      campaignId,
      campaignName: "managed-provider-pilot",
      campaignStatus: "running",
      status: "running",
      readiness: {
        status: "evidence_ready",
        readyForEvidenceReview: true
      },
      latestExecution: {
        id: executionResponse.json().executionId,
        adapterRiskPosture: {
          kind: "managed_provider"
        },
        intentCount: 3,
        deliveryAttemptCount: 3,
        webhookDeliveryCount: 4
      },
      metrics: {
        contactedTargets: 2,
        interestedReplies: 1
      },
      renewalRecommendation: {
        decision: "renew"
      },
      source: {
        readinessUrl: `/campaigns/${campaignId}/readiness`,
        followUpsUrl: `/campaigns/${campaignId}/follow-ups`,
        executionUrl: `/campaigns/${campaignId}/executions/${executionResponse.json().executionId}`,
        executionsUrl: `/campaigns/${campaignId}/executions`
      },
      followUpPlan: {
        latestExecutionId: executionResponse.json().executionId,
        counts: {
          total: 1,
          due: 0,
          pending: 1
        },
        items: [
          {
            targetHandle: "provider_sent",
            sequence: 1,
            message: "Checking back once before I close the loop.",
            status: "pending"
          }
        ]
      }
    });
    expect(proofExport.json().markdown).toContain("Decision: renew");

    const followUps = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/follow-ups`
    });
    expect(followUps.statusCode).toBe(200);
    expect(followUps.json()).toMatchObject({
      campaignId,
      latestExecutionId: executionResponse.json().executionId,
      counts: {
        total: 1,
        due: 0,
        pending: 1
      },
      items: [
        expect.objectContaining({
          targetHandle: "provider_sent",
          senderAccountId: "sender-a",
          sequence: 1,
          message: "Checking back once before I close the loop.",
          status: "pending"
        })
      ]
    });

    await app.close();
  });

  it("exports the newest proof pack when a campaign has multiple executions", async () => {
    const app = await buildServer({ webhookSecret: "latest-proof-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@latest_one", "@latest_two"],
        message: "Open to an affiliate pilot?",
        campaign: "latest-proof-pilot",
        settings: {
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        approvals: {
          approvedTargets: ["@latest_one"],
          actor: "first-pass"
        },
        adapter: {
          kind: "mock",
          replyTargets: []
        }
      }
    });

    const latestExecution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        approvals: {
          approvedTargets: ["@latest_two"],
          actor: "second-pass"
        },
        adapter: {
          kind: "mock",
          replyTargets: ["@latest_two"]
        },
        replyAssessments: [
          {
            targetHandle: "@latest_two",
            disposition: "interested",
            qualified: true,
            replyText: "Interested - send details"
          }
        ]
      }
    });

    const proofExport = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/proof-pack`
    });
    expect(proofExport.statusCode).toBe(200);
    expect(proofExport.json()).toMatchObject({
      latestExecution: {
        id: latestExecution.json().executionId,
        intentCount: 1,
        deliveryAttemptCount: 1
      },
      metrics: {
        interestedReplies: 1
      },
      renewalRecommendation: {
        decision: "renew"
      }
    });

    await app.close();
  });

  it("returns readiness context when latest proof export is not available yet", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@proof_waiting_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "proof-export-empty",
        settings: {
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    const proofExport = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/proof-pack`
    });
    expect(proofExport.statusCode).toBe(404);
    expect(proofExport.json()).toMatchObject({
      error: "proof_pack_not_found",
      campaignId,
      readiness: {
        status: "needs_approval",
        readyForExecution: false,
        counts: {
          executions: 0
        }
      }
    });

    await app.close();
  });

  it("rejects incomplete managed provider outcome contracts", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@provider_one", "@provider_two"],
        message: "Open to an affiliate pilot?",
        campaign: "provider-contract-validation",
        settings: {
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@provider_one", "@provider_two"],
        approveMessage: true,
        actor: "approver"
      }
    });

    const basePayload = {
      adapter: {
        kind: "managed_provider",
        outcomes: [
          {
            target: "@provider_one",
            outcome: "accepted",
            events: [{ type: "sent", messageId: "provider_msg_1" }]
          }
        ]
      }
    };

    const missing = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: basePayload
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().message).toBe("Missing managed provider outcome target(s): provider_two");

    const duplicate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "managed_provider",
          outcomes: [
            ...basePayload.adapter.outcomes,
            ...basePayload.adapter.outcomes
          ]
        }
      }
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().message).toBe("Duplicate managed provider outcome target(s): provider_one");

    const unknown = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "managed_provider",
          outcomes: [
            ...basePayload.adapter.outcomes,
            {
              target: "@provider_two",
              outcome: "accepted",
              events: [{ type: "sent", messageId: "provider_msg_2" }]
            },
            {
              target: "@provider_three",
              outcome: "accepted",
              events: [{ type: "sent", messageId: "provider_msg_3" }]
            }
          ]
        }
      }
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().message).toBe("Unknown managed provider outcome target(s): provider_three");

    const invalidEvent = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "managed_provider",
          outcomes: [
            {
              target: "@provider_one",
              outcome: "accepted",
              events: [{ type: "clicked" }]
            },
            {
              target: "@provider_two",
              outcome: "accepted",
              events: [{ type: "sent", messageId: "provider_msg_2" }]
            }
          ]
        }
      }
    });
    expect(invalidEvent.statusCode).toBe(400);
    expect(invalidEvent.json().error).toBe("invalid_request");

    await app.close();
  });

  it("records concurrent manual evidence without losing execution events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inschneidergram-manual-evidence-"));
    const app = await buildServer({
      store: new JsonFileCampaignStore(join(dir, "campaigns.json")),
      webhookSecret: "atomic-secret"
    });

    try {
      const createResponse = await app.inject({
        method: "POST",
        url: "/campaigns",
        payload: {
          targets: ["@atomic_creator_one", "@atomic_creator_two"],
          message: "Open to an affiliate pilot?",
          campaign: "atomic-manual-evidence",
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
        }
      });
      const campaignId = createResponse.json().campaignId;

      await app.inject({
        method: "POST",
        url: `/campaigns/${campaignId}/approval-workbench`,
        payload: {
          approvedTargets: ["@atomic_creator_one", "@atomic_creator_two"],
          approveMessage: true,
          actor: "approver"
        }
      });
      const executionResponse = await app.inject({
        method: "POST",
        url: `/campaigns/${campaignId}/executions`,
        payload: {
          adapter: { kind: "manual" }
        }
      });
      const executionId = executionResponse.json().executionId;

      const [sentResponse, restrictedResponse] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
          payload: {
            eventId: "atomic-sent-1",
            target: "@atomic_creator_one",
            type: "sent",
            messageId: "manual_atomic_1",
            evidence: {
              operatorId: "op_1",
              conversationUrl: "https://instagram.com/direct/t/atomic_creator_one",
              screenshotUrl: "s3://proof/atomic-sent.png"
            }
          }
        }),
        app.inject({
          method: "POST",
          url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
          payload: {
            eventId: "atomic-restricted-1",
            target: "@atomic_creator_two",
            type: "restricted",
            reason: "Concurrent restriction evidence",
            evidence: {
              operatorId: "op_2",
              screenshotUrl: "s3://proof/atomic-restricted.png",
              restrictionSource: "operator"
            }
          }
        })
      ]);
      expect(sentResponse.statusCode).toBe(200);
      expect(restrictedResponse.statusCode).toBe(200);

      const storedExecution = await app.inject({
        method: "GET",
        url: `/campaigns/${campaignId}/executions/${executionId}`
      });
      const eventsByTarget = Object.fromEntries(
        storedExecution.json().deliveryAttempts.map(
          (attempt: { intent: { targetHandle: string }; events: Array<{ type: string }> }) => [
            attempt.intent.targetHandle,
            attempt.events.map((event) => event.type)
          ]
        )
      );
      expect(eventsByTarget).toEqual({
        atomic_creator_one: ["sent"],
        atomic_creator_two: ["restricted"]
      });
      expect(storedExecution.json().proofPack.metrics).toMatchObject({
        sentMessages: 1,
        deliveryFailures: 1
      });

      const queue = await app.inject({
        method: "GET",
        url: "/operator/manual-queue?status=all"
      });
      expect(queue.json()).toMatchObject({
        counts: {
          pendingInitialEvidence: 0,
          replyMonitoring: 1,
          done: 1
        }
      });
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("excludes mock executions from the manual delivery queue", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@mock_queue_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "mock-queue-pilot",
        settings: {
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@mock_queue_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });
    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "mock" }
      }
    });

    const queue = await app.inject({
      method: "GET",
      url: "/operator/manual-queue?status=all"
    });
    expect(queue.json()).toMatchObject({
      counts: {
        total: 0
      },
      items: []
    });

    await app.close();
  });

  it("blocks launch readiness when sender health has no available accounts", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@blocked_sender_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "readiness-sender-block",
        settings: {
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "locked",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      }
    });

    const readiness = await app.inject({
      method: "GET",
      url: `/campaigns/${createResponse.json().campaignId}/readiness`
    });

    expect(readiness.json()).toMatchObject({
      status: "blocked",
      readyForExecution: false,
      counts: {
        availableSenders: 0
      },
      externalInputs: expect.arrayContaining(["healthy sender account or managed provider"])
    });

    await app.close();
  });

  it("executes an approved mock pilot and returns proof pack evidence", async () => {
    const app = await buildServer({ webhookSecret: "execution-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@creator_one", "@creator_two", "@creator_three"],
        message: "Open to an affiliate pilot?",
        campaign: "api-execution-pilot",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        approvals: {
          approvedTargets: ["@creator_one", "@creator_two", "@creator_three"],
          actor: "api-test"
        },
        adapter: {
          kind: "mock",
          replyTargets: ["@creator_two"],
          failingTargets: ["@creator_three"]
        },
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
            kind: "manual_note",
            severity: "info",
            at: "2026-05-30T01:30:00.000Z",
            note: "API execution dry run"
          }
        ]
      }
    });

    expect(executionResponse.statusCode).toBe(200);
    const executionId = executionResponse.json().executionId;
    expect(executionId).toMatch(/^exec_/);
    expect(executionResponse.json()).toMatchObject({
      status: "running",
      summary: {
        sent: 1,
        replied: 1,
        failed: 1
      },
      adapterRiskPosture: {
        kind: "mock",
        officialColdDmCompliance: "not_claimed"
      },
      proofPack: {
        metrics: {
          approvedTargets: 3,
          contactedTargets: 2,
          interestedReplies: 1,
          webhookDelivered: 4
        },
        renewalRecommendation: {
          decision: "renew"
        }
      }
    });
    expect(executionResponse.json().execution).toMatchObject({
      id: executionId,
      campaignId,
      proofPack: {
        metrics: {
          interestedReplies: 1
        }
      }
    });
    expect(executionResponse.json().deliveryAttempts).toHaveLength(3);
    expect(executionResponse.json().webhookDeliveries).toHaveLength(4);
    expect(executionResponse.json().proofPack.markdown).toContain("Decision: renew");

    const stored = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}`
    });
    expect(stored.json().summary).toMatchObject({
      replied: 1,
      failed: 1
    });

    const executions = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions`
    });
    expect(executions.json()).toMatchObject({
      campaignId,
      executions: [
        {
          id: executionId,
          proofPack: {
            renewalRecommendation: {
              decision: "renew"
            }
          }
        }
      ]
    });

    const executionRecord = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions/${executionId}`
    });
    expect(executionRecord.json()).toMatchObject({
      id: executionId,
      campaignId,
      adapterRiskPosture: {
        kind: "mock",
        officialColdDmCompliance: "not_claimed"
      }
    });

    const manualEvidenceForMock = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        target: "@creator_one",
        type: "sent",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/creator_one",
          screenshotUrl: "s3://proof/mock-manual.png"
        }
      }
    });
    expect(manualEvidenceForMock.statusCode).toBe(409);
    expect(manualEvidenceForMock.json()).toMatchObject({
      error: "conflict"
    });

    await app.close();
  });

  it("supports manual-safe execution without claiming live Instagram delivery", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@creator_one"],
        message: "Open to an affiliate pilot?",
        campaign: "manual-safe-pilot"
      }
    });

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${createResponse.json().campaignId}/executions`,
      payload: {
        approvals: {
          approvedTargets: ["@creator_one"],
          actor: "api-test"
        },
        adapter: {
          kind: "manual"
        }
      }
    });

    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json()).toMatchObject({
      adapterRiskPosture: {
        kind: "manual",
        officialColdDmCompliance: "not_claimed",
        requiresHumanEvidence: true
      },
      proofPack: {
        metrics: {
          contactedTargets: 0,
          sentMessages: 0
        },
        renewalRecommendation: {
          decision: "iterate"
        }
      }
    });

    await app.close();
  });

  it("records manual execution evidence and refreshes persisted proof", async () => {
    const app = await buildServer({ webhookSecret: "manual-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@manual_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "manual-evidence-pilot",
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
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@manual_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });

    const manualExecution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "manual" }
      }
    });
    expect(manualExecution.statusCode).toBe(200);
    const executionId = manualExecution.json().executionId;
    expect(manualExecution.json().deliveryAttempts[0]).toMatchObject({
      outcome: "needs_manual_evidence",
      riskPosture: {
        kind: "manual",
        requiresHumanEvidence: true
      }
    });
    expect(manualExecution.json().proofPack.metrics.contactedTargets).toBe(0);

    const unknownIntent = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        intentId: "intent_missing",
        type: "sent",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-missing.png"
        }
      }
    });
    expect(unknownIntent.statusCode).toBe(404);
    expect(unknownIntent.json()).toMatchObject({
      error: "not_found"
    });

    const incompleteEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        target: "@manual_creator",
        type: "sent",
        evidence: {
          operatorId: "op_1"
        }
      }
    });
    expect(incompleteEvidence.statusCode).toBe(400);
    expect(incompleteEvidence.json().message).toContain("Missing manual evidence for sent");

    const sentEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      headers: {
        "idempotency-key": "manual-sent-1"
      },
      payload: {
        target: "@manual_creator",
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-sent.png"
        }
      }
    });
    expect(sentEvidence.statusCode).toBe(200);
    expect(sentEvidence.json()).toMatchObject({
      summary: {
        sent: 1
      },
      event: {
        id: "manual-sent-1",
        type: "sent",
        messageId: "manual_msg_1"
      },
      proofPack: {
        metrics: {
          approvedTargets: 1,
          contactedTargets: 1,
          webhookDelivered: 1
        }
      }
    });

    const repeatedSentEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      headers: {
        "idempotency-key": "manual-sent-1"
      },
      payload: {
        target: "@manual_creator",
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-sent.png"
        }
      }
    });
    expect(repeatedSentEvidence.statusCode).toBe(200);
    expect(repeatedSentEvidence.json()).toMatchObject({
      summary: {
        sent: 1
      },
      proofPack: {
        metrics: {
          webhookDelivered: 1
        }
      }
    });

    const replyEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "manual-reply-1",
        target: "@manual_creator",
        type: "replied",
        messageId: "manual_msg_1",
        replyText: "Interested - send details",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-reply.png",
          replyCapturedAt: "2026-05-30T01:45:00.000Z"
        },
        replyAssessment: {
          disposition: "interested",
          qualified: true,
          note: "Qualified creator asked for the brief"
        }
      }
    });
    expect(replyEvidence.statusCode).toBe(200);
    expect(replyEvidence.json()).toMatchObject({
      summary: {
        replied: 1
      },
      proofPack: {
        metrics: {
          approvedTargets: 1,
          contactedTargets: 1,
          sentMessages: 1,
          replies: 1,
          interestedReplies: 1,
          webhookDelivered: 2
        },
        renewalRecommendation: {
          decision: "renew"
        }
      }
    });
    expect(
      replyEvidence.json().execution.deliveryAttempts[0].events.map(
        (event: { type: string }) => event.type
      )
    ).toEqual(["sent", "replied"]);

    const storedExecution = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions/${executionId}`
    });
    expect(storedExecution.json()).toMatchObject({
      id: executionId,
      proofPack: {
        metrics: {
          approvedTargets: 1,
          interestedReplies: 1
        }
      }
    });

    const proofExport = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/proof-pack`
    });
    expect(proofExport.statusCode).toBe(200);
    expect(proofExport.json()).toMatchObject({
      campaignId,
      campaignStatus: "completed",
      readiness: {
        status: "evidence_ready",
        readyForEvidenceReview: true
      },
      latestExecution: {
        id: executionId,
        adapterRiskPosture: {
          kind: "manual"
        }
      },
      metrics: {
        contactedTargets: 1,
        interestedReplies: 1,
        webhookDelivered: 2
      },
      renewalRecommendation: {
        decision: "renew"
      }
    });
    expect(proofExport.json().markdown).toContain("Decision: renew");

    await app.close();
  });

  it("reconciles manual restriction evidence into managed sender risk state", async () => {
    const app = await buildServer({ webhookSecret: "manual-risk-secret" });

    await app.inject({
      method: "PUT",
      url: "/senders/sender-a",
      payload: {
        status: "healthy",
        dailyLimit: 20,
        warmupNote: "pilot sender"
      }
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@restricted_manual_creator", "@still_pending_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "manual-restriction-risk-pilot",
        settings: {
          senderPool: ["sender-a"],
          webhookUrl: "https://example.com/webhooks/inschneidergram"
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@restricted_manual_creator", "@still_pending_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });
    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "manual" }
      }
    });
    const executionId = executionResponse.json().executionId;

    const restrictedEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "manual-restricted-1",
        target: "@restricted_manual_creator",
        type: "restricted",
        reason: "Instagram warned the operator to slow down",
        evidence: {
          operatorId: "op_1",
          screenshotUrl: "s3://proof/manual-restricted.png",
          restrictionSource: "instagram-warning"
        }
      }
    });
    expect(restrictedEvidence.statusCode).toBe(200);
    expect(restrictedEvidence.json()).toMatchObject({
      senderHealth: {
        accounts: [
          expect.objectContaining({
            id: "sender-a",
            status: "cooldown",
            available: false,
            blockers: ["cooldown"],
            riskEvents: [
              expect.objectContaining({
                kind: "restriction",
                note: "Manual restriction evidence for restricted_manual_creator: Instagram warned the operator to slow down"
              })
            ]
          })
        ]
      },
      proofPack: {
        metrics: {
          deliveryFailures: 1,
          senderWarnings: 1
        }
      }
    });

    const sender = await app.inject({
      method: "GET",
      url: "/senders/sender-a"
    });
    expect(sender.json()).toMatchObject({
      senderAccount: {
        status: "cooldown",
        riskEvents: [
          expect.objectContaining({
            kind: "restriction"
          })
        ]
      },
      senderHealth: {
        accounts: [
          expect.objectContaining({
            available: false,
            blockers: ["cooldown"]
          })
        ]
      }
    });

    const readiness = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/readiness`
    });
    expect(readiness.json()).toMatchObject({
      status: "blocked",
      readyForExecution: false,
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "sender_health",
          status: "fail"
        })
      ]),
      externalInputs: expect.arrayContaining(["healthy sender account or managed provider"])
    });

    const proofExport = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/proof-pack`
    });
    expect(proofExport.json()).toMatchObject({
      metrics: {
        senderWarnings: 1
      }
    });

    const secondExecution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "manual" }
      }
    });
    expect(secondExecution.statusCode).toBe(409);
    expect(secondExecution.json().message).toContain("Sender health");

    await app.close();
  });

  it("documents the execution workflow in OpenAPI", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/openapi.json"
    });
    const openapi = response.json();

    expect(openapi.security).toEqual([{ ApiKeyAuth: [] }, { BearerAuth: [] }]);
    expect(openapi.components.securitySchemes).toMatchObject({
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key"
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer"
      }
    });
    expect(openapi.paths["/health"].get).toMatchObject({
      summary: "Check API health",
      security: []
    });
    expect(openapi.paths["/openapi.json"].get).toMatchObject({
      summary: "Fetch the OpenAPI contract",
      security: []
    });
    expect(openapi.paths["/webhooks/preview"].post).toMatchObject({
      summary: "Preview a signed webhook payload"
    });
    expect(openapi.paths["/senders"].get).toMatchObject({
      summary: "List managed sender accounts and inventory health"
    });
    expect(openapi.paths["/senders/health"].get).toMatchObject({
      summary: "Inspect managed sender inventory health"
    });
    expect(openapi.paths["/senders/{id}"].get).toMatchObject({
      summary: "Get one managed sender account"
    });
    expect(openapi.paths["/senders/{id}"].put).toMatchObject({
      summary: "Create or update one managed sender account",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              required: ["dailyLimit"]
            }
          }
        }
      }
    });
    expect(openapi.paths["/senders/{id}/risk-events"].post).toMatchObject({
      summary: "Append a sender account risk event",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              required: ["kind", "note"]
            }
          }
        }
      }
    });
    expect(openapi.paths["/operator/manual-queue"].get).toMatchObject({
      summary: "List actionable manual delivery work across campaigns",
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "status", in: "query" }),
        expect.objectContaining({ name: "includeHistorical", in: "query" })
      ])
    });
    expect(openapi.paths["/campaigns/{id}/readiness"].get).toMatchObject({
      summary: "Get pilot launch readiness gates"
    });
    expect(openapi.paths["/campaigns/{id}/proof-pack"].get).toMatchObject({
      summary: "Export the latest campaign proof pack and readiness context",
      responses: {
        "404": {
          description: "Campaign or proof pack not found"
        }
      }
    });
    expect(openapi.paths["/campaigns/{id}/follow-ups"].get).toMatchObject({
      summary: "Inspect planned follow-up work from latest execution evidence"
    });
    expect(openapi.paths["/campaigns/{id}/executions"].get).toMatchObject({
      summary: "List persisted execution proof records for a campaign"
    });
    expect(openapi.paths["/campaigns/{id}/approval-workbench"].post).toMatchObject({
      summary: "Create or replace a persisted approval workbench"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/candidates/{candidateId}/decision"].post
    ).toMatchObject({
      summary: "Approve or reject one creator candidate"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/messages/{messageId}/decision"].post
    ).toMatchObject({
      summary: "Approve or reject one message candidate"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/candidates/{candidateId}/claim"].post
    ).toMatchObject({
      summary: "Claim one approved creator candidate for operator work"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/candidates/{candidateId}/work"].post
    ).toMatchObject({
      summary: "Mark one claimed creator candidate skipped or blocked"
    });
    const executionPost = openapi.paths["/campaigns/{id}/executions"].post;
    expect(executionPost).toMatchObject({
      summary: "Execute approved campaign targets through a mock, manual-safe, or managed-provider adapter",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              properties: {
                adapter: expect.any(Object),
                approvals: expect.any(Object),
                replyAssessments: expect.any(Object)
              }
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Safe execution completed and proof pack returned"
        }
      }
    });
    const adapterCases =
      executionPost.requestBody.content["application/json"].schema.properties.adapter.oneOf;
    expect(adapterCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          required: ["kind", "outcomes"],
          properties: expect.objectContaining({
            kind: { const: "managed_provider" },
            accountRiskOwner: expect.objectContaining({
              enum: ["operator", "provider"]
            }),
            outcomes: expect.objectContaining({
              minItems: 1,
              items: expect.objectContaining({
                required: ["target", "outcome", "events"],
                properties: expect.objectContaining({
                  outcome: expect.objectContaining({ enum: ["accepted", "rejected"] }),
                  events: expect.objectContaining({
                    minItems: 1,
                    items: expect.objectContaining({
                      properties: expect.objectContaining({
                        type: expect.objectContaining({
                          enum: ["sent", "failed", "restricted", "replied"]
                        })
                      })
                    })
                  })
                })
              })
            })
          })
        })
      ])
    );
    expect(openapi.paths["/campaigns/{id}/executions/{executionId}"].get).toMatchObject({
      summary: "Get one persisted execution proof record"
    });
    expect(openapi.paths["/campaigns/{id}/executions/{executionId}/manual-queue"].get).toMatchObject({
      summary: "List manual delivery work for one execution"
    });
    expect(openapi.paths["/campaigns/{id}/executions/{executionId}/manual-events"].post).toMatchObject({
      summary: "Record manual evidence for one execution intent",
      responses: {
        "409": {
          description: "Execution or manual event state conflict"
        }
      }
    });
    expect(openapi.paths["/webhooks/dead-letters"].get).toMatchObject({
      summary: "List dead-lettered outgoing webhook deliveries"
    });
    expect(openapi.paths["/webhooks/dead-letters/{id}/replay"].post).toMatchObject({
      summary: "Replay one dead-lettered outgoing webhook delivery"
    });

    await app.close();
  });

  it("documents required OpenAPI path parameters for templated routes", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/openapi.json"
    });
    const openapi = response.json();

    for (const [path, operations] of Object.entries(openapi.paths) as Array<[string, any]>) {
      const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      if (names.length === 0) {
        continue;
      }

      const parameters = operations.parameters ?? [];
      for (const name of names) {
        expect(parameters).toContainEqual(
          expect.objectContaining({
            name,
            in: "path",
            required: true
          })
        );
      }
    }

    await app.close();
  });

  it("documents runtime campaign request fields in OpenAPI", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/openapi.json"
    });
    const post = response.json().paths["/campaigns"].post;
    const schema = post.requestBody.content["application/json"].schema;

    expect(post.parameters).toContainEqual(
      expect.objectContaining({
        name: "Idempotency-Key",
        in: "header"
      })
    );
    expect(schema).toMatchObject({
      required: ["targets", "campaign"],
      oneOf: [{ required: ["message"] }, { required: ["template"] }],
      properties: {
        targets: {
          items: {
            oneOf: expect.arrayContaining([
              expect.objectContaining({ type: "string" }),
              expect.objectContaining({
                type: "object",
                required: ["target"],
                properties: expect.objectContaining({
                  source: expect.any(Object),
                  fitReason: expect.any(Object)
                })
              })
            ])
          }
        },
        template: {
          properties: {
            body: { type: "string" },
            variables: {
              additionalProperties: { type: "string" }
            }
          }
        },
        metadata: {
          additionalProperties: true
        },
        settings: {
          properties: {
            dailyLimitPerSender: { type: "integer" },
            minDelaySeconds: { type: "integer" },
            maxDelaySeconds: { type: "integer" },
            senderAccounts: {
              items: {
                properties: {
                  status: {
                    enum: ["healthy", "cooldown", "locked", "reconnect_required"]
                  },
                  riskEvents: expect.any(Object)
                }
              }
            },
            requireTargetProvenance: {
              type: "boolean"
            },
            followUps: {
              items: {
                required: ["delayHours", "message"]
              }
            }
          }
        }
      }
    });

    await app.close();
  });

  it("documents manual evidence event-specific requirements in OpenAPI", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/openapi.json"
    });
    const operation =
      response.json().paths["/campaigns/{id}/executions/{executionId}/manual-events"].post;
    const cases = operation.requestBody.content["application/json"].schema.oneOf;
    const byType = Object.fromEntries(
      cases.map((schema: any) => [schema.properties.type.const, schema])
    );

    expect(operation.parameters).toContainEqual(
      expect.objectContaining({
        name: "Idempotency-Key",
        in: "header"
      })
    );
    expect(operation.description).toContain("simulated");
    expect(byType.sent.required).toEqual(expect.arrayContaining(["type", "evidence", "messageId"]));
    expect(byType.sent.anyOf).toEqual([{ required: ["intentId"] }, { required: ["target"] }]);
    expect(byType.sent.properties.evidence.required).toEqual(
      expect.arrayContaining(["operatorId", "conversationUrl", "screenshotUrl"])
    );
    expect(byType.failed.required).toEqual(expect.arrayContaining(["type", "evidence", "reason"]));
    expect(byType.restricted.properties.evidence.required).toEqual(
      expect.arrayContaining(["operatorId", "screenshotUrl", "restrictionSource"])
    );
    expect(byType.replied.required).toEqual(
      expect.arrayContaining(["type", "evidence", "messageId", "replyText"])
    );
    expect(byType.replied.properties.evidence.required).toEqual(
      expect.arrayContaining(["operatorId", "conversationUrl", "screenshotUrl", "replyCapturedAt"])
    );

    await app.close();
  });
});
