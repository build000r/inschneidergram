import { buildServer } from "../src/server.js";

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
});
