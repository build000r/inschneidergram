import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeInstagramHandle } from "./handles.js";

export const targetEventSchema = z.object({
  target: z.string().min(1),
  event: z.enum(["sent", "delivered", "reply", "failed"]),
  eventId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  receivedAt: z.string().datetime().optional()
});

const defaultCampaignSettings = {
  dailyLimitPerSender: 35,
  minDelaySeconds: 90,
  maxDelaySeconds: 420,
  senderPool: ["unassigned"],
  dryRun: true,
  followUps: []
} satisfies {
  dailyLimitPerSender: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  senderPool: string[];
  dryRun: boolean;
  followUps: Array<{ delayHours: number; message: string }>;
};

const campaignSettingsSchema = z
  .object({
    dailyLimitPerSender: z.number().int().min(1).max(200).default(35),
    minDelaySeconds: z.number().int().min(10).max(86400).default(90),
    maxDelaySeconds: z.number().int().min(10).max(86400).default(420),
    senderPool: z.array(z.string().min(1)).min(1).default(["unassigned"]),
    webhookUrl: z.string().url().optional(),
    dryRun: z.boolean().default(true),
    followUps: z
      .array(
        z.object({
          delayHours: z.number().int().min(1).max(168),
          message: z.string().min(1).max(1000)
        })
      )
      .max(5)
      .default([])
  })
  .default(defaultCampaignSettings);

export const createCampaignSchema = z.object({
  targets: z.array(z.string().min(1)).min(1).max(5000),
  message: z.string().min(1).max(1000).optional(),
  template: z
    .object({
      body: z.string().min(1).max(1000),
      variables: z.record(z.string(), z.string()).default({})
    })
    .optional(),
  campaign: z.string().min(1).max(120),
  metadata: z.record(z.string(), z.unknown()).default({}),
  settings: campaignSettingsSchema
}).superRefine((value, ctx) => {
  if (!value.message && !value.template) {
    ctx.addIssue({
      code: "custom",
      message: "Provide either message or template.body",
      path: ["message"]
    });
  }

  const settings = value.settings ?? {};
  if (
    settings.minDelaySeconds !== undefined &&
    settings.maxDelaySeconds !== undefined &&
    settings.minDelaySeconds > settings.maxDelaySeconds
  ) {
    ctx.addIssue({
      code: "custom",
      message: "minDelaySeconds must be less than or equal to maxDelaySeconds",
      path: ["settings", "minDelaySeconds"]
    });
  }
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type TargetEventInput = z.infer<typeof targetEventSchema>;

export type CampaignStatus = "queued" | "running" | "completed" | "failed";
export type TargetStatus =
  | "scheduled"
  | "sent"
  | "delivered"
  | "replied"
  | "failed"
  | "skipped_duplicate"
  | "blocked_policy";

export interface CampaignTarget {
  raw: string;
  handle: string | null;
  status: TargetStatus;
  sender: string | null;
  scheduledAt: string | null;
  messageId?: string;
  error?: string;
  events: Array<{
    event: TargetEventInput["event"];
    eventId: string;
    receivedAt: string;
  }>;
}

export interface Campaign {
  id: string;
  campaign: string;
  status: CampaignStatus;
  message: string;
  settings: Required<Omit<CreateCampaignInput["settings"], "webhookUrl">> & {
    webhookUrl?: string;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  targets: CampaignTarget[];
  summary: CampaignSummary;
}

export interface CampaignSummary {
  total: number;
  scheduled: number;
  sent: number;
  delivered: number;
  replied: number;
  failed: number;
  skippedDuplicate: number;
  blockedPolicy: number;
}

export function createCampaign(
  input: unknown,
  now = new Date()
): Campaign {
  const parsed = createCampaignSchema.parse(input);
  const nowIso = now.toISOString();
  const message = parsed.message ?? parsed.template?.body ?? "";
  const targets = buildTargets(parsed, now);

  return summarizeCampaign({
    id: `camp_${randomUUID()}`,
    campaign: parsed.campaign,
    status: "queued",
    message,
    settings: {
      dailyLimitPerSender: parsed.settings.dailyLimitPerSender,
      minDelaySeconds: parsed.settings.minDelaySeconds,
      maxDelaySeconds: parsed.settings.maxDelaySeconds,
      senderPool: parsed.settings.senderPool,
      dryRun: parsed.settings.dryRun,
      followUps: parsed.settings.followUps,
      webhookUrl: parsed.settings.webhookUrl
    },
    metadata: parsed.metadata,
    createdAt: nowIso,
    updatedAt: nowIso,
    targets,
    summary: emptySummary()
  });
}

export function recordTargetEvent(
  campaign: Campaign,
  input: unknown,
  now = new Date()
): Campaign {
  const event = targetEventSchema.parse(input);
  const handle = normalizeInstagramHandle(event.target);
  const target = campaign.targets.find((candidate) => candidate.handle === handle);

  if (!target) {
    throw new Error(`Target not found in campaign: ${event.target}`);
  }

  const eventId = event.eventId ?? `${event.event}:${event.messageId ?? randomUUID()}`;
  if (target.events.some((existing) => existing.eventId === eventId)) {
    return campaign;
  }

  target.events.push({
    event: event.event,
    eventId,
    receivedAt: event.receivedAt ?? now.toISOString()
  });

  if (event.messageId) {
    target.messageId = event.messageId;
  }

  switch (event.event) {
    case "sent":
      target.status = "sent";
      break;
    case "delivered":
      target.status = "delivered";
      break;
    case "reply":
      target.status = "replied";
      break;
    case "failed":
      target.status = "failed";
      target.error = event.error ?? "Provider reported failure";
      break;
  }

  return summarizeCampaign({
    ...campaign,
    updatedAt: now.toISOString()
  });
}

function buildTargets(
  input: CreateCampaignInput,
  now: Date
): CampaignTarget[] {
  const seen = new Set<string>();
  const senderSlots = new Map<string, number>();
  const spacingSeconds = Math.round(
    (input.settings.minDelaySeconds + input.settings.maxDelaySeconds) / 2
  );

  return input.targets.map((raw) => {
    let handle: string;

    try {
      handle = normalizeInstagramHandle(raw);
    } catch (error) {
      return {
        raw,
        handle: null,
        status: "blocked_policy",
        sender: null,
        scheduledAt: null,
        error: error instanceof Error ? error.message : "Invalid target",
        events: []
      };
    }

    if (seen.has(handle)) {
      return {
        raw,
        handle,
        status: "skipped_duplicate",
        sender: null,
        scheduledAt: null,
        events: []
      };
    }

    seen.add(handle);
    const sender = chooseSender(input.settings.senderPool, seen.size - 1);
    const senderSlot = senderSlots.get(sender) ?? 0;
    senderSlots.set(sender, senderSlot + 1);

    return {
      raw,
      handle,
      status: "scheduled",
      sender,
      scheduledAt: scheduleAt(
        now,
        senderSlot,
        spacingSeconds,
        input.settings.dailyLimitPerSender
      ),
      events: []
    };
  });
}

function chooseSender(senderPool: string[], targetIndex: number): string {
  return senderPool[targetIndex % senderPool.length] ?? "unassigned";
}

function scheduleAt(
  now: Date,
  senderSlot: number,
  spacingSeconds: number,
  dailyLimitPerSender: number
): string {
  const dayOffset = Math.floor(senderSlot / dailyLimitPerSender);
  const slotInDay = senderSlot % dailyLimitPerSender;
  const timestamp =
    now.getTime() + dayOffset * 24 * 60 * 60 * 1000 + slotInDay * spacingSeconds * 1000;
  return new Date(timestamp).toISOString();
}

function summarizeCampaign(campaign: Campaign): Campaign {
  const summary = emptySummary();
  summary.total = campaign.targets.length;

  for (const target of campaign.targets) {
    switch (target.status) {
      case "scheduled":
        summary.scheduled += 1;
        break;
      case "sent":
        summary.sent += 1;
        break;
      case "delivered":
        summary.delivered += 1;
        break;
      case "replied":
        summary.replied += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "skipped_duplicate":
        summary.skippedDuplicate += 1;
        break;
      case "blocked_policy":
        summary.blockedPolicy += 1;
        break;
    }
  }

  const actionable = summary.scheduled + summary.sent + summary.delivered + summary.replied;
  const terminal =
    summary.delivered +
    summary.replied +
    summary.failed +
    summary.skippedDuplicate +
    summary.blockedPolicy;

  campaign.summary = summary;
  campaign.status =
    actionable === 0
      ? "failed"
      : terminal === summary.total
        ? "completed"
        : summary.sent + summary.delivered + summary.replied > 0
          ? "running"
          : "queued";
  return campaign;
}

function emptySummary(): CampaignSummary {
  return {
    total: 0,
    scheduled: 0,
    sent: 0,
    delivered: 0,
    replied: 0,
    failed: 0,
    skippedDuplicate: 0,
    blockedPolicy: 0
  };
}
