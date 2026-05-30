import type { Campaign, CampaignTarget, CreateCampaignInput } from "./campaign.js";
import type { DeliveryAttempt } from "./delivery.js";
import { newestExecutionsFirst, type CampaignExecutionRecord } from "./store.js";

export type FollowUpStatus = "due" | "pending";

export interface FollowUpPlanItem {
  id: string;
  campaignId: string;
  campaignName: string;
  executionId: string;
  intentId: string;
  target: string;
  targetHandle: string;
  senderAccountId: string;
  sequence: number;
  message: string;
  dueAt: string;
  status: FollowUpStatus;
  lastSentAt: string;
  profile?: CampaignTarget["profile"];
}

export interface FollowUpPlan {
  generatedAt: string;
  campaignId: string;
  campaignName: string;
  followUpRules: Required<CreateCampaignInput["settings"]>["followUps"];
  latestExecutionId: string | null;
  counts: {
    total: number;
    due: number;
    pending: number;
  };
  items: FollowUpPlanItem[];
}

export function buildFollowUpPlan(input: {
  campaign: Campaign;
  executions?: CampaignExecutionRecord[];
  generatedAt?: Date | string;
}): FollowUpPlan {
  const generatedAt = toDate(input.generatedAt);
  const latestExecution = latestExecutionWithAttempts(input.executions ?? []);
  const items = latestExecution
    ? followUpItemsForExecution(input.campaign, latestExecution, generatedAt)
    : [];

  return {
    generatedAt: generatedAt.toISOString(),
    campaignId: input.campaign.id,
    campaignName: input.campaign.campaign,
    followUpRules: input.campaign.settings.followUps,
    latestExecutionId: latestExecution?.id ?? null,
    counts: {
      total: items.length,
      due: items.filter((item) => item.status === "due").length,
      pending: items.filter((item) => item.status === "pending").length
    },
    items
  };
}

function followUpItemsForExecution(
  campaign: Campaign,
  execution: CampaignExecutionRecord,
  generatedAt: Date
): FollowUpPlanItem[] {
  if (campaign.settings.followUps.length === 0) {
    return [];
  }

  return execution.deliveryAttempts
    .flatMap((attempt) => followUpItemsForAttempt(campaign, execution, attempt, generatedAt))
    .sort((left, right) =>
      left.dueAt.localeCompare(right.dueAt) || left.targetHandle.localeCompare(right.targetHandle)
    );
}

function followUpItemsForAttempt(
  campaign: Campaign,
  execution: CampaignExecutionRecord,
  attempt: DeliveryAttempt,
  generatedAt: Date
): FollowUpPlanItem[] {
  const sentAt = latestSentAt(attempt);
  if (!sentAt || hasTerminalOrReplyEvent(attempt)) {
    return [];
  }

  const target = campaign.targets.find(
    (candidate) => candidate.handle === attempt.intent.targetHandle
  );
  if (!target || target.status === "skipped_duplicate" || target.status === "blocked_policy") {
    return [];
  }

  return campaign.settings.followUps.map((rule, index) => {
    const sequence = index + 1;
    const dueAt = addHours(sentAt, rule.delayHours).toISOString();
    return {
      id: `${execution.id}:${attempt.intent.id}:follow_up_${sequence}`,
      campaignId: campaign.id,
      campaignName: campaign.campaign,
      executionId: execution.id,
      intentId: attempt.intent.id,
      target: attempt.intent.target,
      targetHandle: attempt.intent.targetHandle,
      senderAccountId: attempt.intent.senderAccountId,
      sequence,
      message: rule.message,
      dueAt,
      status: dueAt <= generatedAt.toISOString() ? "due" : "pending",
      lastSentAt: sentAt,
      ...(target.profile ? { profile: target.profile } : {})
    };
  });
}

function latestExecutionWithAttempts(
  executions: CampaignExecutionRecord[]
): CampaignExecutionRecord | undefined {
  return newestExecutionsFirst(
    executions.filter((execution) => execution.deliveryAttempts.length > 0)
  )[0];
}

function latestSentAt(attempt: DeliveryAttempt): string | null {
  return attempt.events
    .filter((event) => event.type === "sent")
    .map((event) => event.occurredAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function hasTerminalOrReplyEvent(attempt: DeliveryAttempt): boolean {
  return attempt.events.some((event) =>
    event.type === "replied" || event.type === "failed" || event.type === "restricted"
  );
}

function addHours(iso: string, hours: number): Date {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000);
}

function toDate(value: Date | string | undefined): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  return new Date();
}
