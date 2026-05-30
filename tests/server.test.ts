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
});
