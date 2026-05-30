import { createCampaign, recordTargetEvent } from "../src/domain/campaign.js";
import {
  buildSignedWebhookRequest,
  createCampaignWebhookJob,
  createCampaignWebhookPayload,
  createTargetWebhookJob,
  createTargetWebhookPayload,
  OutgoingWebhookDispatcher,
  type OutgoingWebhookRequest
} from "../src/domain/outgoingWebhook.js";
import { verifyWebhookSignature } from "../src/domain/webhook.js";

describe("outgoing signed webhooks", () => {
  it("signs campaign and target event payloads with the existing webhook helper", () => {
    const campaign = createCampaign(
      {
        targets: ["@creator_one"],
        message: "Open to an affiliate pilot?",
        campaign: "graphed-pilot",
        settings: {
          webhookUrl: "https://example.com/inschneidergram/events"
        }
      },
      new Date("2026-05-30T01:00:00.000Z")
    );
    const secret = "test-webhook-secret";

    const campaignJob = createCampaignWebhookJob(campaign, "campaign.created", {
      id: "evt_campaign_created",
      occurredAt: "2026-05-30T01:00:01.000Z"
    });

    expect(campaignJob).not.toBeNull();
    const campaignRequest = buildSignedWebhookRequest(campaignJob!, secret);
    expect(campaignRequest.headers).toMatchObject({
      "x-inschneidergram-event-id": "evt_campaign_created",
      "x-inschneidergram-event-type": "campaign.created"
    });
    expect(
      verifyWebhookSignature(
        campaignRequest.payload,
        secret,
        campaignRequest.headers["x-inschneidergram-signature"]!
      )
    ).toBe(true);

    const updated = recordTargetEvent(
      campaign,
      {
        target: "@creator_one",
        event: "sent",
        eventId: "evt_target_sent",
        messageId: "provider_msg_1",
        receivedAt: "2026-05-30T01:02:00.000Z"
      },
      new Date("2026-05-30T01:02:00.000Z")
    );
    const targetJob = createTargetWebhookJob(updated, updated.targets[0]!, undefined, {
      occurredAt: "2026-05-30T01:02:01.000Z"
    });

    expect(targetJob).not.toBeNull();
    const targetRequest = buildSignedWebhookRequest(targetJob!, secret, 2);
    expect(targetRequest.payload).toMatchObject({
      id: "evt_target_sent",
      type: "target.sent",
      target: {
        handle: "creator_one",
        status: "sent",
        messageId: "provider_msg_1",
        latestEvent: {
          event: "sent",
          eventId: "evt_target_sent"
        }
      }
    });
    expect(targetRequest.headers["x-inschneidergram-delivery-attempt"]).toBe("2");
    expect(
      verifyWebhookSignature(
        targetRequest.payload,
        secret,
        targetRequest.headers["x-inschneidergram-signature"]!
      )
    ).toBe(true);
  });

  it("retries retryable failures after backoff before marking delivery successful", async () => {
    const requests: OutgoingWebhookRequest[] = [];
    const dispatcher = new OutgoingWebhookDispatcher({
      secret: "retry-secret",
      maxAttempts: 3,
      backoffMs: (attempt) => attempt * 1000,
      async sender(request) {
        requests.push(request);
        return {
          statusCode: requests.length === 1 ? 503 : 202
        };
      }
    });
    const job = {
      id: "evt_retry",
      url: "https://example.com/webhooks/retry",
      payload: createCampaignWebhookPayload(baseCampaign(), "campaign.updated", {
        id: "evt_retry",
        occurredAt: "2026-05-30T01:05:00.000Z"
      })
    };

    const first = await dispatcher.dispatch(job, new Date("2026-05-30T01:05:00.000Z"));

    expect(first.status).toBe("pending");
    expect(first.nextAttemptAt).toBe("2026-05-30T01:05:01.000Z");
    expect(requests).toHaveLength(1);

    await dispatcher.drainDue(new Date("2026-05-30T01:05:00.999Z"));
    expect(requests).toHaveLength(1);

    const processed = await dispatcher.drainDue(new Date("2026-05-30T01:05:01.000Z"));

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.attempt)).toEqual([1, 2]);
    expect(processed[0]).toMatchObject({
      id: "evt_retry",
      status: "delivered",
      deliveredAt: "2026-05-30T01:05:01.000Z"
    });
    expect(dispatcher.get("evt_retry")?.attempts.map((attempt) => attempt.success)).toEqual([
      false,
      true
    ]);
  });

  it("moves non-retryable permanent failures to dead letter state", async () => {
    const dispatcher = new OutgoingWebhookDispatcher({
      secret: "dead-letter-secret",
      maxAttempts: 3,
      async sender() {
        return { statusCode: 400 };
      }
    });
    const job = {
      id: "evt_permanent_failure",
      url: "https://example.com/webhooks/permanent-failure",
      payload: createCampaignWebhookPayload(baseCampaign(), "campaign.updated", {
        id: "evt_permanent_failure",
        occurredAt: "2026-05-30T01:10:00.000Z"
      })
    };

    const record = await dispatcher.dispatch(job, new Date("2026-05-30T01:10:00.000Z"));

    expect(record).toMatchObject({
      status: "dead_letter",
      nextAttemptAt: null,
      deadLetteredAt: "2026-05-30T01:10:00.000Z",
      lastError: "HTTP 400"
    });
    expect(record.attempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        statusCode: 400,
        retryable: false,
        success: false
      })
    ]);
    expect(dispatcher.deadLetters()).toHaveLength(1);
  });

  it("replays dead-lettered deliveries with the original signed payload", async () => {
    const requests: OutgoingWebhookRequest[] = [];
    let acceptingReplay = false;
    const dispatcher = new OutgoingWebhookDispatcher({
      secret: "replay-secret",
      maxAttempts: 2,
      backoffMs: () => 1000,
      async sender(request) {
        requests.push(request);
        return {
          statusCode: acceptingReplay ? 204 : 503
        };
      }
    });
    const campaign = baseCampaign();
    const job = {
      id: "evt_replay",
      url: "https://example.com/webhooks/replay",
      payload: createTargetWebhookPayload(campaign, campaign.targets[0]!, "target.updated", {
        id: "evt_replay",
        occurredAt: "2026-05-30T01:15:00.000Z"
      })
    };

    await dispatcher.dispatch(job, new Date("2026-05-30T01:15:00.000Z"));
    await dispatcher.drainDue(new Date("2026-05-30T01:15:01.000Z"));

    expect(dispatcher.get("evt_replay")).toMatchObject({
      status: "dead_letter",
      attempts: [
        expect.objectContaining({ attempt: 1, success: false }),
        expect.objectContaining({ attempt: 2, success: false })
      ]
    });

    acceptingReplay = true;
    const replayed = dispatcher.replay("evt_replay", new Date("2026-05-30T01:16:00.000Z"));
    expect(replayed).toMatchObject({
      status: "pending",
      nextAttemptAt: "2026-05-30T01:16:00.000Z"
    });

    await dispatcher.drainDue(new Date("2026-05-30T01:16:00.000Z"));
    const delivered = dispatcher.get("evt_replay");

    expect(delivered).toMatchObject({
      status: "delivered",
      deliveredAt: "2026-05-30T01:16:00.000Z"
    });
    expect(delivered?.attempts.map((attempt) => attempt.success)).toEqual([
      false,
      false,
      true
    ]);
    expect(requests[2]?.payload).toEqual(job.payload);
    expect(
      verifyWebhookSignature(
        requests[2]!.payload,
        "replay-secret",
        requests[2]!.headers["x-inschneidergram-signature"]!
      )
    ).toBe(true);
  });
});

function baseCampaign() {
  return createCampaign(
    {
      targets: ["@creator_one"],
      message: "Open to an affiliate pilot?",
      campaign: "graphed-pilot",
      settings: {
        webhookUrl: "https://example.com/inschneidergram/events"
      }
    },
    new Date("2026-05-30T01:00:00.000Z")
  );
}
