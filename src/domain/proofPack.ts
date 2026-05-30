import type { ApprovalWorkbench } from "./approval.js";
import type { Campaign } from "./campaign.js";
import type { DeliveryAttempt, DeliveryEvent } from "./delivery.js";
import type { WebhookDeliveryRecord } from "./outgoingWebhook.js";
import type { SenderInventoryHealth } from "./sender.js";

export type PilotIncidentKind =
  | "sender_warning"
  | "sender_restriction"
  | "delivery_failure"
  | "quality_issue"
  | "opt_out"
  | "complaint"
  | "manual_note";

export type PilotIncidentSeverity = "info" | "warning" | "critical";
export type ReplyDisposition =
  | "interested"
  | "neutral"
  | "not_interested"
  | "opt_out"
  | "complaint";

export interface PilotIncident {
  kind: PilotIncidentKind;
  severity: PilotIncidentSeverity;
  at: string;
  note: string;
  targetHandle?: string;
  senderAccountId?: string;
}

export interface ReplyAssessment {
  targetHandle: string;
  disposition: ReplyDisposition;
  qualified: boolean;
  replyText?: string;
  note?: string;
}

export interface PilotProofPackInput {
  campaign: Campaign;
  approvalWorkbench?: ApprovalWorkbench;
  deliveryAttempts?: DeliveryAttempt[];
  webhookDeliveries?: WebhookDeliveryRecord[];
  replyAssessments?: ReplyAssessment[];
  incidents?: PilotIncident[];
  generatedAt?: Date | string;
}

export interface PilotProofMetrics {
  sourcedTargets: number;
  acceptedTargets: number;
  approvedTargets: number;
  approvedCopy: number;
  contactedTargets: number;
  sentMessages: number;
  deliveredMessages: number;
  replies: number;
  interestedReplies: number;
  duplicateSkips: number;
  blockedTargets: number;
  optOuts: number;
  complaints: number;
  deliveryFailures: number;
  senderWarnings: number;
  webhookDelivered: number;
  webhookDeadLetters: number;
}

export type RenewalDecision = "renew" | "iterate" | "stop";

export interface RenewalRecommendation {
  decision: RenewalDecision;
  reasons: string[];
}

export interface PilotProofPack {
  generatedAt: string;
  campaignId: string;
  campaignName: string;
  metrics: PilotProofMetrics;
  senderHealth: SenderInventoryHealth;
  incidents: PilotIncident[];
  replies: ReplyAssessment[];
  renewalRecommendation: RenewalRecommendation;
  markdown: string;
}

export function generatePilotProofPack(input: PilotProofPackInput): PilotProofPack {
  const generatedAt = toIso(input.generatedAt);
  const metrics = buildMetrics(input);
  const pack: Omit<PilotProofPack, "markdown"> = {
    generatedAt,
    campaignId: input.campaign.id,
    campaignName: input.campaign.campaign,
    metrics,
    senderHealth: input.campaign.senderHealth,
    incidents: [...(input.incidents ?? [])],
    replies: [...(input.replyAssessments ?? [])],
    renewalRecommendation: recommendRenewal(metrics, input.campaign.senderHealth, input.incidents ?? [])
  };

  return {
    ...pack,
    markdown: renderPilotProofMarkdown(pack)
  };
}

export function renderPilotProofMarkdown(pack: Omit<PilotProofPack, "markdown">): string {
  return [
    `# Pilot Proof Pack: ${pack.campaignName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    `Campaign ID: ${pack.campaignId}`,
    "",
    "## Metrics",
    "| Metric | Count |",
    "| --- | ---: |",
    metricRow("Sourced targets", pack.metrics.sourcedTargets),
    metricRow("Accepted targets", pack.metrics.acceptedTargets),
    metricRow("Approved targets", pack.metrics.approvedTargets),
    metricRow("Approved first-touch copy", pack.metrics.approvedCopy),
    metricRow("Contacted targets", pack.metrics.contactedTargets),
    metricRow("Sent messages", pack.metrics.sentMessages),
    metricRow("Delivered messages", pack.metrics.deliveredMessages),
    metricRow("Replies", pack.metrics.replies),
    metricRow("Interested replies", pack.metrics.interestedReplies),
    metricRow("Duplicate skips", pack.metrics.duplicateSkips),
    metricRow("Blocked targets", pack.metrics.blockedTargets),
    metricRow("Opt-outs", pack.metrics.optOuts),
    metricRow("Complaints", pack.metrics.complaints),
    metricRow("Delivery failures", pack.metrics.deliveryFailures),
    metricRow("Sender warnings", pack.metrics.senderWarnings),
    metricRow("Webhook delivered", pack.metrics.webhookDelivered),
    metricRow("Webhook dead letters", pack.metrics.webhookDeadLetters),
    "",
    "## Sender Health",
    `Available senders: ${pack.senderHealth.available}/${pack.senderHealth.total}`,
    ...pack.senderHealth.accounts.map((account) => {
      const blockers = account.blockers.length > 0 ? account.blockers.join(", ") : "none";
      return `- ${account.id}: ${account.status}, dailyLimit=${account.dailyLimit}, blockers=${blockers}`;
    }),
    "",
    "## Replies",
    ...listOrNone(
      pack.replies.map((reply) => {
        const qualified = reply.qualified ? "qualified" : "unqualified";
        return `- ${reply.targetHandle}: ${reply.disposition} (${qualified})${reply.note ? ` - ${reply.note}` : ""}`;
      })
    ),
    "",
    "## Incidents",
    ...listOrNone(
      pack.incidents.map((incident) => {
        const subject = incident.targetHandle ?? incident.senderAccountId ?? "campaign";
        return `- ${incident.at} ${incident.severity} ${incident.kind} ${subject}: ${incident.note}`;
      })
    ),
    "",
    "## Renewal Recommendation",
    `Decision: ${pack.renewalRecommendation.decision}`,
    ...pack.renewalRecommendation.reasons.map((reason) => `- ${reason}`),
    ""
  ].join("\n");
}

function buildMetrics(input: PilotProofPackInput): PilotProofMetrics {
  const sentHandles = new Set<string>();
  const repliedHandles = new Set<string>();
  const failedEvents: DeliveryEvent[] = [];

  for (const attempt of input.deliveryAttempts ?? []) {
    for (const event of attempt.events) {
      if (event.type === "sent") {
        sentHandles.add(attempt.intent.targetHandle);
      }
      if (event.type === "replied") {
        repliedHandles.add(attempt.intent.targetHandle);
      }
      if (event.type === "failed" || event.type === "restricted") {
        failedEvents.push(event);
      }
    }
  }

  for (const target of input.campaign.targets) {
    if (target.handle && ["sent", "delivered", "replied"].includes(target.status)) {
      sentHandles.add(target.handle);
    }
    if (target.handle && target.status === "replied") {
      repliedHandles.add(target.handle);
    }
  }

  const replyAssessments = input.replyAssessments ?? [];
  const incidents = input.incidents ?? [];
  const webhookDeliveries = input.webhookDeliveries ?? [];
  const senderRiskEvents = input.campaign.senderHealth.accounts.flatMap(
    (account) => account.riskEvents
  );
  const senderWarnings =
    senderRiskEvents.filter((event) =>
      ["warning", "restriction", "lockout", "reconnect_required"].includes(event.kind)
    ).length +
    incidents.filter(
      (incident) => incident.kind === "sender_warning" || incident.kind === "sender_restriction"
    ).length;

  return {
    sourcedTargets: input.campaign.summary.total,
    acceptedTargets:
      input.campaign.summary.total -
      input.campaign.summary.skippedDuplicate -
      input.campaign.summary.blockedPolicy,
    approvedTargets: input.approvalWorkbench?.summary.candidates.approved ?? 0,
    approvedCopy: input.approvalWorkbench?.summary.messages.approved ?? 0,
    contactedTargets: sentHandles.size,
    sentMessages: sentHandles.size,
    deliveredMessages: input.campaign.summary.delivered,
    replies: Math.max(input.campaign.summary.replied, repliedHandles.size),
    interestedReplies: replyAssessments.filter(
      (reply) => reply.disposition === "interested" || reply.qualified
    ).length,
    duplicateSkips: input.campaign.summary.skippedDuplicate,
    blockedTargets: input.campaign.summary.blockedPolicy,
    optOuts:
      replyAssessments.filter((reply) => reply.disposition === "opt_out").length +
      incidents.filter((incident) => incident.kind === "opt_out").length,
    complaints:
      replyAssessments.filter((reply) => reply.disposition === "complaint").length +
      incidents.filter((incident) => incident.kind === "complaint").length,
    deliveryFailures:
      input.campaign.summary.failed +
      failedEvents.length +
      incidents.filter((incident) => incident.kind === "delivery_failure").length,
    senderWarnings,
    webhookDelivered: webhookDeliveries.filter((delivery) => delivery.status === "delivered").length,
    webhookDeadLetters: webhookDeliveries.filter((delivery) => delivery.status === "dead_letter")
      .length
  };
}

function recommendRenewal(
  metrics: PilotProofMetrics,
  senderHealth: SenderInventoryHealth,
  incidents: PilotIncident[]
): RenewalRecommendation {
  const reasons: string[] = [];
  const hasCriticalIncident = incidents.some((incident) => incident.severity === "critical");

  if (metrics.complaints > 0) {
    reasons.push(`${metrics.complaints} complaint(s) require remediation before renewal.`);
  }
  if (hasCriticalIncident) {
    reasons.push("Critical incident present in the pilot evidence.");
  }
  if (senderHealth.available === 0) {
    reasons.push("No sender accounts are currently healthy.");
  }

  if (reasons.length > 0) {
    return { decision: "stop", reasons };
  }

  if (metrics.interestedReplies > 0) {
    return {
      decision: "renew",
      reasons: [
        `${metrics.interestedReplies} interested or qualified reply/replies captured.`,
        "No complaints or critical incidents were recorded."
      ]
    };
  }

  if (metrics.contactedTargets > 0) {
    return {
      decision: "iterate",
      reasons: [
        `${metrics.contactedTargets} target(s) were contacted, but no interested replies were captured yet.`
      ]
    };
  }

  return {
    decision: "iterate",
    reasons: ["Pilot evidence is not yet strong enough for renewal."]
  };
}

function metricRow(label: string, value: number): string {
  return `| ${label} | ${value} |`;
}

function listOrNone(entries: string[]): string[] {
  return entries.length > 0 ? entries : ["- none"];
}

function toIso(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ?? new Date().toISOString();
}
