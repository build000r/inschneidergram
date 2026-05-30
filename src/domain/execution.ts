import type { ApprovalWorkbench } from "./approval.js";
import {
  type Campaign,
  type CampaignTarget,
  recordTargetEvent
} from "./campaign.js";
import {
  createSendIntent,
  type DeliveryAttempt,
  type ManagedDeliveryAdapter,
  type SendIntent
} from "./delivery.js";
import { normalizeInstagramHandle } from "./handles.js";
import {
  createTargetWebhookJob,
  type OutgoingWebhookDispatcher,
  type WebhookDeliveryRecord
} from "./outgoingWebhook.js";
import {
  generatePilotProofPack,
  type PilotIncident,
  type PilotProofPack,
  type ReplyAssessment
} from "./proofPack.js";

export interface CampaignExecutionInput {
  campaign: Campaign;
  workbench: ApprovalWorkbench;
  adapter: ManagedDeliveryAdapter;
  webhookDispatcher?: OutgoingWebhookDispatcher;
  replyAssessments?: ReplyAssessment[];
  incidents?: PilotIncident[];
  now?: Date;
}

export interface CampaignExecutionResult {
  campaign: Campaign;
  intents: SendIntent[];
  deliveryAttempts: DeliveryAttempt[];
  webhookDeliveries: WebhookDeliveryRecord[];
  proofPack: PilotProofPack;
}

export async function executeApprovedCampaign(
  input: CampaignExecutionInput
): Promise<CampaignExecutionResult> {
  const now = input.now ?? new Date();
  const message = approvedMessage(input.workbench);
  let campaign = structuredClone(input.campaign);
  const intents: SendIntent[] = [];
  const deliveryAttempts: DeliveryAttempt[] = [];
  const webhookDeliveries: WebhookDeliveryRecord[] = [];

  for (const target of campaign.targets) {
    if (!isExecutableTarget(target) || !isApprovedCandidate(input.workbench, target)) {
      continue;
    }

    const intent = createSendIntent(
      {
        campaignId: campaign.id,
        target: target.handle,
        senderAccountId: target.sender,
        message: message.body,
        scheduledAt: target.scheduledAt,
        approvedAt: input.workbench.updatedAt,
        metadata: {
          campaign: campaign.campaign,
          targetRaw: target.raw,
          workbenchId: input.workbench.id
        }
      },
      now
    );
    const attempt = input.adapter.deliver(intent, now);

    intents.push(intent);
    deliveryAttempts.push(attempt);

    for (const event of attempt.events) {
      campaign = recordTargetEvent(
        campaign,
        {
          target: intent.targetHandle,
          event: event.type === "replied" ? "reply" : event.type === "restricted" ? "failed" : event.type,
          eventId: event.id,
          messageId: event.messageId,
          error: event.reason,
          receivedAt: event.occurredAt
        },
        now
      );

      const updatedTarget = campaign.targets.find(
        (candidate) => candidate.handle === intent.targetHandle
      );
      if (updatedTarget && input.webhookDispatcher) {
        const job = createTargetWebhookJob(campaign, updatedTarget);
        if (job) {
          webhookDeliveries.push(await input.webhookDispatcher.dispatch(job, now));
        }
      }
    }
  }

  return {
    campaign,
    intents,
    deliveryAttempts,
    webhookDeliveries,
    proofPack: generatePilotProofPack({
      campaign,
      approvalWorkbench: input.workbench,
      deliveryAttempts,
      webhookDeliveries,
      replyAssessments: input.replyAssessments,
      incidents: input.incidents,
      generatedAt: now
    })
  };
}

function approvedMessage(workbench: ApprovalWorkbench): { id: string; body: string } {
  const message = workbench.messages.find((candidate) => candidate.approval === "approved");
  if (!message) {
    throw new Error("Campaign execution requires approved message copy");
  }
  return message;
}

function isExecutableTarget(target: CampaignTarget): boolean {
  return target.status === "scheduled" && !!target.handle && !!target.sender && !!target.scheduledAt;
}

function isApprovedCandidate(workbench: ApprovalWorkbench, target: CampaignTarget): boolean {
  if (!target.handle) {
    return false;
  }

  const handle = normalizeInstagramHandle(target.handle);
  return workbench.candidates.some(
    (candidate) =>
      candidate.handle === handle &&
      candidate.approval === "approved" &&
      (candidate.work === "queued" || candidate.work === "claimed")
  );
}
