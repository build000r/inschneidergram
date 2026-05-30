import { randomUUID } from "node:crypto";
import type {
  Campaign,
  CampaignSummary,
  CampaignStatus,
  CampaignTarget,
  TargetStatus
} from "./campaign.js";
import { signWebhookPayload } from "./webhook.js";

export type CampaignWebhookEventType =
  | "campaign.created"
  | "campaign.updated"
  | "campaign.completed"
  | "campaign.failed";

export type TargetWebhookEventType =
  | "target.updated"
  | "target.sent"
  | "target.delivered"
  | "target.replied"
  | "target.failed"
  | "target.skipped"
  | "target.blocked";

export type OutgoingWebhookEventType = CampaignWebhookEventType | TargetWebhookEventType;

export type WebhookDeliveryStatus = "pending" | "delivered" | "dead_letter";

export interface OutgoingWebhookPayload {
  id: string;
  type: OutgoingWebhookEventType;
  occurredAt: string;
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    summary: CampaignSummary;
    metadata: Record<string, unknown>;
  };
  target?: {
    raw: string;
    handle: string | null;
    status: TargetStatus;
    sender: string | null;
    scheduledAt: string | null;
    messageId?: string;
    error?: string;
    latestEvent?: {
      event: string;
      eventId: string;
      receivedAt: string;
    };
  };
  data: Record<string, unknown>;
}

export interface OutgoingWebhookJob {
  id: string;
  url: string;
  payload: OutgoingWebhookPayload;
}

export interface OutgoingWebhookRequest {
  url: string;
  payload: OutgoingWebhookPayload;
  headers: Record<string, string>;
  attempt: number;
}

export interface OutgoingWebhookSenderResult {
  statusCode: number;
  body?: unknown;
}

export type OutgoingWebhookSender = (
  request: OutgoingWebhookRequest
) => Promise<OutgoingWebhookSenderResult | void>;

export interface WebhookDeliveryAttempt {
  attempt: number;
  attemptedAt: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  retryable: boolean;
  nextAttemptAt?: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  url: string;
  payload: OutgoingWebhookPayload;
  status: WebhookDeliveryStatus;
  attempts: WebhookDeliveryAttempt[];
  nextAttemptAt: string | null;
  deliveredAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
}

export interface OutgoingWebhookDispatcherOptions {
  secret: string;
  sender: OutgoingWebhookSender;
  maxAttempts?: number;
  backoffMs?: (attempt: number, record: WebhookDeliveryRecord) => number;
  retryableStatusCodes?: (statusCode: number) => boolean;
}

export interface WebhookPayloadOptions {
  id?: string;
  occurredAt?: Date | string;
  data?: Record<string, unknown>;
}

const defaultMaxAttempts = 3;

export function createCampaignWebhookPayload(
  campaign: Campaign,
  type: CampaignWebhookEventType = campaignEventTypeForStatus(campaign.status),
  options: WebhookPayloadOptions = {}
): OutgoingWebhookPayload {
  return {
    id: options.id ?? `evt_${randomUUID()}`,
    type,
    occurredAt: timestamp(options.occurredAt),
    campaign: campaignSnapshot(campaign),
    data: options.data ?? {}
  };
}

export function createTargetWebhookPayload(
  campaign: Campaign,
  target: CampaignTarget,
  type: TargetWebhookEventType = targetEventTypeForStatus(target.status),
  options: WebhookPayloadOptions = {}
): OutgoingWebhookPayload {
  const latestEvent = target.events.at(-1);

  return {
    id: options.id ?? latestEvent?.eventId ?? `evt_${randomUUID()}`,
    type,
    occurredAt: timestamp(options.occurredAt ?? latestEvent?.receivedAt),
    campaign: campaignSnapshot(campaign),
    target: {
      raw: target.raw,
      handle: target.handle,
      status: target.status,
      sender: target.sender,
      scheduledAt: target.scheduledAt,
      messageId: target.messageId,
      error: target.error,
      latestEvent
    },
    data: options.data ?? {}
  };
}

export function createCampaignWebhookJob(
  campaign: Campaign,
  type?: CampaignWebhookEventType,
  options: WebhookPayloadOptions = {}
): OutgoingWebhookJob | null {
  return jobForCampaignUrl(
    campaign,
    createCampaignWebhookPayload(campaign, type, options)
  );
}

export function createTargetWebhookJob(
  campaign: Campaign,
  target: CampaignTarget,
  type?: TargetWebhookEventType,
  options: WebhookPayloadOptions = {}
): OutgoingWebhookJob | null {
  return jobForCampaignUrl(
    campaign,
    createTargetWebhookPayload(campaign, target, type, options)
  );
}

export function buildSignedWebhookRequest(
  job: OutgoingWebhookJob,
  secret: string,
  attempt = 1
): OutgoingWebhookRequest {
  return {
    url: job.url,
    payload: job.payload,
    attempt,
    headers: {
      "content-type": "application/json",
      "user-agent": "inschneidergram-webhooks/0.1",
      "x-inschneidergram-delivery-attempt": String(attempt),
      "x-inschneidergram-event-id": job.payload.id,
      "x-inschneidergram-event-type": job.payload.type,
      "x-inschneidergram-signature": signWebhookPayload(job.payload, secret)
    }
  };
}

export class OutgoingWebhookDispatcher {
  private readonly deliveries = new Map<string, WebhookDeliveryRecord>();
  private readonly secret: string;
  private readonly sender: OutgoingWebhookSender;
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempt: number, record: WebhookDeliveryRecord) => number;
  private readonly retryableStatusCodes: (statusCode: number) => boolean;

  constructor(options: OutgoingWebhookDispatcherOptions) {
    this.secret = options.secret;
    this.sender = options.sender;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? defaultMaxAttempts);
    this.backoffMs = options.backoffMs ?? exponentialBackoffMs;
    this.retryableStatusCodes = options.retryableStatusCodes ?? defaultRetryableStatusCode;
  }

  enqueue(job: OutgoingWebhookJob, now = new Date()): WebhookDeliveryRecord {
    const existing = this.deliveries.get(job.id);
    if (existing) {
      return structuredClone(existing);
    }

    const record: WebhookDeliveryRecord = {
      id: job.id,
      url: job.url,
      payload: structuredClone(job.payload),
      status: "pending",
      attempts: [],
      nextAttemptAt: now.toISOString()
    };

    this.deliveries.set(record.id, record);
    return structuredClone(record);
  }

  async dispatch(job: OutgoingWebhookJob, now = new Date()): Promise<WebhookDeliveryRecord> {
    this.enqueue(job, now);
    await this.drainDue(now);
    return this.mustGet(job.id);
  }

  async drainDue(now = new Date()): Promise<WebhookDeliveryRecord[]> {
    const processed: WebhookDeliveryRecord[] = [];
    const nowTime = now.getTime();

    for (const record of this.deliveries.values()) {
      if (record.status !== "pending" || !record.nextAttemptAt) {
        continue;
      }

      if (Date.parse(record.nextAttemptAt) > nowTime) {
        continue;
      }

      await this.attemptDelivery(record, now);
      processed.push(structuredClone(record));
    }

    return processed;
  }

  replay(id: string, now = new Date()): WebhookDeliveryRecord {
    const record = this.deliveries.get(id);
    if (!record) {
      throw new Error(`Webhook delivery not found: ${id}`);
    }

    if (record.status !== "dead_letter") {
      throw new Error(`Only dead-lettered webhook deliveries can be replayed: ${id}`);
    }

    record.status = "pending";
    record.nextAttemptAt = now.toISOString();
    delete record.deadLetteredAt;
    delete record.lastError;
    return structuredClone(record);
  }

  get(id: string): WebhookDeliveryRecord | null {
    const record = this.deliveries.get(id);
    return record ? structuredClone(record) : null;
  }

  deadLetters(): WebhookDeliveryRecord[] {
    return [...this.deliveries.values()]
      .filter((record) => record.status === "dead_letter")
      .map((record) => structuredClone(record));
  }

  private async attemptDelivery(
    record: WebhookDeliveryRecord,
    now: Date
  ): Promise<void> {
    const attemptNumber = record.attempts.length + 1;
    const request = buildSignedWebhookRequest(
      {
        id: record.id,
        url: record.url,
        payload: record.payload
      },
      this.secret,
      attemptNumber
    );
    const attemptedAt = now.toISOString();

    try {
      const result = await this.sender(request);
      const statusCode = result?.statusCode ?? 204;

      if (isSuccessfulStatusCode(statusCode)) {
        record.attempts.push({
          attempt: attemptNumber,
          attemptedAt,
          success: true,
          statusCode,
          retryable: false
        });
        record.status = "delivered";
        record.nextAttemptAt = null;
        record.deliveredAt = attemptedAt;
        delete record.lastError;
        return;
      }

      this.recordFailure(
        record,
        {
          attempt: attemptNumber,
          attemptedAt,
          success: false,
          statusCode,
          error: `HTTP ${statusCode}`,
          retryable: this.retryableStatusCodes(statusCode)
        },
        now
      );
    } catch (error) {
      this.recordFailure(
        record,
        {
          attempt: attemptNumber,
          attemptedAt,
          success: false,
          error: errorMessage(error),
          retryable: true
        },
        now
      );
    }
  }

  private recordFailure(
    record: WebhookDeliveryRecord,
    attempt: WebhookDeliveryAttempt,
    now: Date
  ): void {
    const exhausted = attempt.attempt >= this.maxAttempts;
    record.lastError = attempt.error ?? "Webhook delivery failed";

    if (attempt.retryable && !exhausted) {
      const nextAttemptAt = new Date(
        now.getTime() + Math.max(0, this.backoffMs(attempt.attempt, structuredClone(record)))
      ).toISOString();

      attempt.nextAttemptAt = nextAttemptAt;
      record.attempts.push(attempt);
      record.status = "pending";
      record.nextAttemptAt = nextAttemptAt;
      return;
    }

    record.attempts.push(attempt);
    record.status = "dead_letter";
    record.nextAttemptAt = null;
    record.deadLetteredAt = now.toISOString();
  }

  private mustGet(id: string): WebhookDeliveryRecord {
    const record = this.get(id);
    if (!record) {
      throw new Error(`Webhook delivery not found: ${id}`);
    }
    return record;
  }
}

function jobForCampaignUrl(
  campaign: Campaign,
  payload: OutgoingWebhookPayload
): OutgoingWebhookJob | null {
  const webhookUrl = campaign.settings.webhookUrl;
  if (!webhookUrl) {
    return null;
  }

  return {
    id: payload.id,
    url: webhookUrl,
    payload
  };
}

function campaignSnapshot(campaign: Campaign): OutgoingWebhookPayload["campaign"] {
  return {
    id: campaign.id,
    name: campaign.campaign,
    status: campaign.status,
    summary: structuredClone(campaign.summary),
    metadata: structuredClone(campaign.metadata)
  };
}

function campaignEventTypeForStatus(status: CampaignStatus): CampaignWebhookEventType {
  if (status === "completed") {
    return "campaign.completed";
  }

  if (status === "failed") {
    return "campaign.failed";
  }

  return "campaign.updated";
}

function targetEventTypeForStatus(status: TargetStatus): TargetWebhookEventType {
  switch (status) {
    case "sent":
      return "target.sent";
    case "delivered":
      return "target.delivered";
    case "replied":
      return "target.replied";
    case "failed":
      return "target.failed";
    case "skipped_duplicate":
      return "target.skipped";
    case "blocked_policy":
      return "target.blocked";
    case "scheduled":
      return "target.updated";
  }
}

function timestamp(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ?? new Date().toISOString();
}

function exponentialBackoffMs(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}

function defaultRetryableStatusCode(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isSuccessfulStatusCode(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Webhook sender threw";
}
