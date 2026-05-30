import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeInstagramHandle } from "./handles.js";

export const deliveryEventTypes = ["sent", "failed", "restricted", "replied"] as const;

export type DeliveryEventType = (typeof deliveryEventTypes)[number];
export type DeliveryAdapterKind = "mock" | "manual" | "managed_provider";
export type DeliveryOutcome = "accepted" | "needs_manual_evidence" | "rejected";

export interface DeliveryAdapterRiskPosture {
  kind: DeliveryAdapterKind;
  officialColdDmCompliance: "not_claimed";
  accountRiskOwner: "none" | "operator" | "provider";
  requiresHumanEvidence: boolean;
  posture: "simulation_only" | "human_operated" | "provider_operated";
  notes: string[];
}

export interface ManualEvidenceRequirement {
  key: string;
  label: string;
  requiredFor: DeliveryEventType[];
  description: string;
}

export interface SendIntent {
  id: string;
  campaignId: string;
  target: string;
  targetHandle: string;
  senderAccountId: string;
  message: string;
  scheduledAt: string;
  approvedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface DeliveryEvent {
  id: string;
  intentId: string;
  adapterId: string;
  type: DeliveryEventType;
  occurredAt: string;
  messageId?: string;
  reason?: string;
  replyText?: string;
  evidence: Record<string, string>;
}

export interface DeliveryAttempt {
  adapterId: string;
  outcome: DeliveryOutcome;
  intent: SendIntent;
  events: DeliveryEvent[];
  requiredEvidence: ManualEvidenceRequirement[];
  riskPosture: DeliveryAdapterRiskPosture;
}

export interface ManagedDeliveryAdapter {
  id: string;
  riskPosture: DeliveryAdapterRiskPosture;
  evidenceRequirements: ManualEvidenceRequirement[];
  deliver(intent: SendIntent, now?: Date): DeliveryAttempt;
}

export interface ManagedProviderDeliveryAdapterOptions {
  id?: string;
  accountRiskOwner?: "operator" | "provider";
  requiresHumanEvidence?: boolean;
  notes?: string[];
  deliver(
    intent: SendIntent,
    now: Date
  ): {
    outcome: DeliveryOutcome;
    events: Array<{
      type: DeliveryEventType;
      occurredAt?: string;
      messageId?: string;
      reason?: string;
      replyText?: string;
      evidence?: Record<string, string>;
    }>;
  };
}

export const sendIntentSchema = z.object({
  id: z.string().min(1).optional(),
  campaignId: z.string().min(1),
  target: z.string().min(1),
  senderAccountId: z.string().min(1),
  message: z.string().min(1).max(1000),
  scheduledAt: z.string().datetime().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const manualDeliveryEventSchema = z.object({
  type: z.enum(deliveryEventTypes),
  occurredAt: z.string().datetime().optional(),
  messageId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  replyText: z.string().min(1).optional(),
  evidence: z.record(z.string(), z.string()).default({})
});

export type SendIntentInput = z.input<typeof sendIntentSchema>;
export type ManualDeliveryEventInput = z.input<typeof manualDeliveryEventSchema>;

export const manualEvidenceRequirements: ManualEvidenceRequirement[] = [
  {
    key: "operatorId",
    label: "Operator ID",
    requiredFor: ["sent", "failed", "restricted", "replied"],
    description: "Identifies the person who performed or verified the manual action."
  },
  {
    key: "conversationUrl",
    label: "Conversation URL",
    requiredFor: ["sent", "replied"],
    description: "Points to the Instagram conversation used for pilot verification."
  },
  {
    key: "screenshotUrl",
    label: "Screenshot URL",
    requiredFor: ["sent", "restricted", "replied"],
    description: "Stores non-secret visual proof for the pilot audit trail."
  },
  {
    key: "restrictionSource",
    label: "Restriction Source",
    requiredFor: ["restricted"],
    description: "Names the source of the send restriction, lockout, or account-health block."
  },
  {
    key: "replyCapturedAt",
    label: "Reply Captured At",
    requiredFor: ["replied"],
    description: "Records when the reply evidence was captured."
  }
];

export function createSendIntent(input: unknown, now = new Date()): SendIntent {
  const parsed = sendIntentSchema.parse(input);

  return {
    id: parsed.id ?? `intent_${randomUUID()}`,
    campaignId: parsed.campaignId,
    target: parsed.target,
    targetHandle: normalizeInstagramHandle(parsed.target),
    senderAccountId: parsed.senderAccountId,
    message: parsed.message,
    scheduledAt: parsed.scheduledAt ?? now.toISOString(),
    approvedAt: parsed.approvedAt ?? null,
    metadata: parsed.metadata
  };
}

export function createMockDeliveryAdapter(
  options: {
    id?: string;
    restrictedTargets?: string[];
    failingTargets?: string[];
    replyTargets?: string[];
  } = {}
): ManagedDeliveryAdapter {
  const restrictedTargets = normalizeTargetSet(options.restrictedTargets ?? []);
  const failingTargets = normalizeTargetSet(options.failingTargets ?? []);
  const replyTargets = normalizeTargetSet(options.replyTargets ?? []);
  const id = options.id ?? "mock_delivery";

  return {
    id,
    riskPosture: {
      kind: "mock",
      officialColdDmCompliance: "not_claimed",
      accountRiskOwner: "none",
      requiresHumanEvidence: false,
      posture: "simulation_only",
      notes: [
        "Simulates adapter behavior for contract tests and pilot dry runs.",
        "Does not represent real Instagram delivery or official cold-DM compliance."
      ]
    },
    evidenceRequirements: [],
    deliver(intent: SendIntent, now = new Date()): DeliveryAttempt {
      if (restrictedTargets.has(intent.targetHandle)) {
        return buildAttempt(this, intent, "rejected", [
          buildEvent(this.id, intent.id, "restricted", now, {
            reason: "Target is configured as restricted in the mock adapter"
          })
        ]);
      }

      if (failingTargets.has(intent.targetHandle)) {
        return buildAttempt(this, intent, "rejected", [
          buildEvent(this.id, intent.id, "failed", now, {
            reason: "Target is configured to fail in the mock adapter"
          })
        ]);
      }

      const sent = buildEvent(this.id, intent.id, "sent", now, {
        messageId: `mock_msg_${intent.id}`
      });
      const events = [sent];

      if (replyTargets.has(intent.targetHandle)) {
        events.push(
          buildEvent(this.id, intent.id, "replied", now, {
            messageId: sent.messageId,
            replyText: "Mock reply captured for proof-pack testing"
          })
        );
      }

      return buildAttempt(this, intent, "accepted", events);
    }
  };
}

export function createManualDeliveryAdapter(id = "manual_delivery"): ManagedDeliveryAdapter {
  return {
    id,
    riskPosture: {
      kind: "manual",
      officialColdDmCompliance: "not_claimed",
      accountRiskOwner: "operator",
      requiresHumanEvidence: true,
      posture: "human_operated",
      notes: [
        "Requires an operator to perform or verify delivery outside this codebase.",
        "Records evidence for a managed pilot without claiming official cold-DM compliance."
      ]
    },
    evidenceRequirements: manualEvidenceRequirements,
    deliver(intent: SendIntent): DeliveryAttempt {
      return buildAttempt(this, intent, "needs_manual_evidence", []);
    }
  };
}

export function createManagedProviderDeliveryAdapter(
  options: ManagedProviderDeliveryAdapterOptions
): ManagedDeliveryAdapter {
  const id = options.id ?? "managed_provider_delivery";

  return {
    id,
    riskPosture: {
      kind: "managed_provider",
      officialColdDmCompliance: "not_claimed",
      accountRiskOwner: options.accountRiskOwner ?? "provider",
      requiresHumanEvidence: options.requiresHumanEvidence ?? false,
      posture: "provider_operated",
      notes: options.notes ?? [
        "Delegates delivery to a managed provider adapter supplied by the operator.",
        "Adapter must still report restrictions and failures without claiming official cold-DM compliance."
      ]
    },
    evidenceRequirements: [],
    deliver(intent: SendIntent, now = new Date()): DeliveryAttempt {
      const result = options.deliver(intent, now);
      return buildAttempt(
        this,
        intent,
        result.outcome,
        result.events.map((event) =>
          buildEvent(this.id, intent.id, event.type, now, {
            occurredAt: event.occurredAt,
            messageId: event.messageId,
            reason: event.reason,
            replyText: event.replyText,
            evidence: event.evidence
          })
        )
      );
    }
  };
}

export function recordManualDeliveryEvent(
  adapter: ManagedDeliveryAdapter,
  intent: SendIntent,
  input: unknown,
  now = new Date()
): DeliveryEvent {
  if (adapter.riskPosture.kind !== "manual") {
    throw new Error("Manual evidence can only be recorded against a manual adapter");
  }

  const parsed = manualDeliveryEventSchema.parse(input);
  const missing = missingEvidence(adapter.evidenceRequirements, parsed.type, parsed.evidence);

  if (missing.length > 0) {
    throw new Error(`Missing manual evidence for ${parsed.type}: ${missing.join(", ")}`);
  }

  if ((parsed.type === "failed" || parsed.type === "restricted") && !parsed.reason) {
    throw new Error(`${parsed.type} events require a reason`);
  }

  if (parsed.type === "replied" && !parsed.replyText) {
    throw new Error("replied events require replyText");
  }

  return buildEvent(adapter.id, intent.id, parsed.type, now, {
    occurredAt: parsed.occurredAt,
    messageId: parsed.messageId,
    reason: parsed.reason,
    replyText: parsed.replyText,
    evidence: parsed.evidence
  });
}

function buildAttempt(
  adapter: ManagedDeliveryAdapter,
  intent: SendIntent,
  outcome: DeliveryOutcome,
  events: DeliveryEvent[]
): DeliveryAttempt {
  return {
    adapterId: adapter.id,
    outcome,
    intent,
    events,
    requiredEvidence: adapter.evidenceRequirements,
    riskPosture: adapter.riskPosture
  };
}

function buildEvent(
  adapterId: string,
  intentId: string,
  type: DeliveryEventType,
  now: Date,
  values: {
    occurredAt?: string;
    messageId?: string;
    reason?: string;
    replyText?: string;
    evidence?: Record<string, string>;
  } = {}
): DeliveryEvent {
  return {
    id: `evt_${randomUUID()}`,
    intentId,
    adapterId,
    type,
    occurredAt: values.occurredAt ?? now.toISOString(),
    messageId: values.messageId,
    reason: values.reason,
    replyText: values.replyText,
    evidence: values.evidence ?? {}
  };
}

function missingEvidence(
  requirements: ManualEvidenceRequirement[],
  eventType: DeliveryEventType,
  evidence: Record<string, string>
): string[] {
  return requirements
    .filter((requirement) => requirement.requiredFor.includes(eventType))
    .map((requirement) => requirement.key)
    .filter((key) => !evidence[key]);
}

function normalizeTargetSet(targets: string[]): Set<string> {
  return new Set(targets.map((target) => normalizeInstagramHandle(target)));
}
