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
});
