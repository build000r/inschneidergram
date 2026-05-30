import {
  createManagedProviderDeliveryAdapter,
  createManualDeliveryAdapter,
  createMockDeliveryAdapter,
  createSendIntent,
  recordManualDeliveryEvent
} from "../src/domain/delivery.js";

describe("managed delivery adapter contract", () => {
  it("creates normalized send intents for adapter handoff", () => {
    const intent = createSendIntent(
      {
        campaignId: "camp_123",
        target: "https://instagram.com/Creator.One/?hl=en",
        senderAccountId: "sender_a",
        message: "Open to an affiliate pilot?",
        approvedAt: "2026-05-30T01:00:00.000Z"
      },
      new Date("2026-05-30T01:05:00.000Z")
    );

    expect(intent).toMatchObject({
      campaignId: "camp_123",
      targetHandle: "creator.one",
      senderAccountId: "sender_a",
      scheduledAt: "2026-05-30T01:05:00.000Z",
      approvedAt: "2026-05-30T01:00:00.000Z"
    });
    expect(intent.id).toMatch(/^intent_/);
  });

  it("mock adapter emits sent and replied events without claiming real delivery", () => {
    const adapter = createMockDeliveryAdapter({
      replyTargets: ["@creator_one"]
    });
    const intent = createSendIntent({
      id: "intent_1",
      campaignId: "camp_123",
      target: "@creator_one",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });

    const attempt = adapter.deliver(intent, new Date("2026-05-30T01:10:00.000Z"));

    expect(attempt.outcome).toBe("accepted");
    expect(attempt.events.map((event) => event.type)).toEqual(["sent", "replied"]);
    expect(attempt.events[0]).toMatchObject({
      adapterId: "mock_delivery",
      intentId: "intent_1",
      messageId: "mock_msg_intent_1"
    });
    expect(attempt.riskPosture).toMatchObject({
      kind: "mock",
      officialColdDmCompliance: "not_claimed",
      posture: "simulation_only"
    });
  });

  it("mock adapter reports restricted and failed outcomes as delivery events", () => {
    const adapter = createMockDeliveryAdapter({
      restrictedTargets: ["restricted_creator"],
      failingTargets: ["failing_creator"]
    });
    const restrictedIntent = createSendIntent({
      id: "intent_restricted",
      campaignId: "camp_123",
      target: "restricted_creator",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });
    const failingIntent = createSendIntent({
      id: "intent_failed",
      campaignId: "camp_123",
      target: "failing_creator",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });

    expect(adapter.deliver(restrictedIntent).events[0]).toMatchObject({
      type: "restricted",
      reason: "Target is configured as restricted in the mock adapter"
    });
    expect(adapter.deliver(failingIntent).events[0]).toMatchObject({
      type: "failed",
      reason: "Target is configured to fail in the mock adapter"
    });
  });

  it("manual adapter requires evidence before sent or replied events are recorded", () => {
    const adapter = createManualDeliveryAdapter();
    const intent = createSendIntent({
      id: "intent_manual",
      campaignId: "camp_123",
      target: "@creator_one",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });

    const attempt = adapter.deliver(intent);

    expect(attempt).toMatchObject({
      outcome: "needs_manual_evidence",
      events: [],
      riskPosture: {
        kind: "manual",
        officialColdDmCompliance: "not_claimed",
        requiresHumanEvidence: true
      }
    });
    expect(attempt.requiredEvidence.map((requirement) => requirement.key)).toContain(
      "screenshotUrl"
    );

    expect(() =>
      recordManualDeliveryEvent(adapter, intent, {
        type: "sent",
        evidence: {
          operatorId: "op_1"
        }
      })
    ).toThrow("Missing manual evidence for sent: conversationUrl, screenshotUrl");

    const sent = recordManualDeliveryEvent(
      adapter,
      intent,
      {
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/123",
          screenshotUrl: "s3://proof/sent.png"
        }
      },
      new Date("2026-05-30T01:15:00.000Z")
    );

    expect(sent).toMatchObject({
      type: "sent",
      adapterId: "manual_delivery",
      intentId: "intent_manual",
      messageId: "manual_msg_1",
      occurredAt: "2026-05-30T01:15:00.000Z"
    });
  });

  it("manual replied events require reply text and reply-specific evidence", () => {
    const adapter = createManualDeliveryAdapter();
    const intent = createSendIntent({
      id: "intent_reply",
      campaignId: "camp_123",
      target: "@creator_one",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });

    expect(() =>
      recordManualDeliveryEvent(adapter, intent, {
        type: "replied",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/123",
          screenshotUrl: "s3://proof/reply.png",
          replyCapturedAt: "2026-05-30T01:20:00.000Z"
        }
      })
    ).toThrow("replied events require replyText");

    expect(
      recordManualDeliveryEvent(adapter, intent, {
        type: "replied",
        replyText: "Interested - send details",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/123",
          screenshotUrl: "s3://proof/reply.png",
          replyCapturedAt: "2026-05-30T01:20:00.000Z"
        }
      })
    ).toMatchObject({
      type: "replied",
      replyText: "Interested - send details"
    });
  });

  it("provider adapter boundary reports managed provider events without compliance claims", () => {
    const adapter = createManagedProviderDeliveryAdapter({
      id: "provider_boundary",
      deliver(intent) {
        if (intent.targetHandle === "restricted_creator") {
          return {
            outcome: "rejected",
            events: [
              {
                type: "restricted",
                reason: "provider reported sender cooldown",
                evidence: { providerAttemptId: "attempt_2" }
              }
            ]
          };
        }

        return {
          outcome: "accepted",
          events: [
            {
              type: "sent",
              messageId: "provider_msg_1",
              evidence: { providerAttemptId: "attempt_1" }
            }
          ]
        };
      }
    });
    const sentIntent = createSendIntent({
      id: "intent_provider_sent",
      campaignId: "camp_123",
      target: "@creator_one",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });
    const restrictedIntent = createSendIntent({
      id: "intent_provider_restricted",
      campaignId: "camp_123",
      target: "@restricted_creator",
      senderAccountId: "sender_a",
      message: "Open to an affiliate pilot?"
    });

    expect(adapter.deliver(sentIntent).events[0]).toMatchObject({
      type: "sent",
      messageId: "provider_msg_1",
      evidence: { providerAttemptId: "attempt_1" }
    });
    expect(adapter.deliver(restrictedIntent).events[0]).toMatchObject({
      type: "restricted",
      reason: "provider reported sender cooldown"
    });
    expect(adapter.riskPosture).toMatchObject({
      kind: "managed_provider",
      officialColdDmCompliance: "not_claimed",
      accountRiskOwner: "provider"
    });
  });
});
