import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import {
  approveCandidate,
  approveMessage,
  createApprovalWorkbench,
  rejectCandidate
} from "./domain/approval.js";
import { createCampaign, recordTargetEvent, type Campaign } from "./domain/campaign.js";
import {
  createManualDeliveryAdapter,
  createMockDeliveryAdapter
} from "./domain/delivery.js";
import { executeApprovedCampaign } from "./domain/execution.js";
import { normalizeInstagramHandle } from "./domain/handles.js";
import { OutgoingWebhookDispatcher } from "./domain/outgoingWebhook.js";
import { InMemoryCampaignStore, type CampaignStore } from "./domain/store.js";
import { signWebhookPayload } from "./domain/webhook.js";

export interface ServerOptions {
  store?: CampaignStore;
  webhookSecret?: string;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? new InMemoryCampaignStore();
  const webhookSecret = options.webhookSecret ?? "dev-secret";
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({
    ok: true,
    service: "inschneidergram",
    provider: process.env.INSCHNEIDERGRAM_PROVIDER ?? "mock"
  }));

  app.post("/campaigns", async (request, reply) => {
    try {
      const campaign = await store.insert(
        createCampaign(withIdempotencyKey(request.body, request.headers["idempotency-key"]))
      );
      const response = {
        campaignId: campaign.id,
        status: campaign.status,
        summary: campaign.summary,
        senderHealth: campaign.senderHealth,
        targets: campaign.targets
      };
      return reply.code(202).send(response);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/campaigns", async () => ({
    campaigns: await store.list()
  }));

  app.get("/campaigns/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    return campaign;
  });

  app.post("/campaigns/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    try {
      const updated = await store.update(recordTargetEvent(campaign, request.body));
      return {
        campaignId: updated.id,
        status: updated.status,
        summary: updated.summary,
        senderHealth: updated.senderHealth
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/campaigns/:id/executions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    try {
      const executionRequest = executionRequestSchema.parse(request.body ?? {});
      const workbench = buildApprovalWorkbench(campaign, executionRequest);
      const dispatcher = executionRequest.simulateWebhooks
        ? new OutgoingWebhookDispatcher({
            secret: webhookSecret,
            sender: async () => ({
              statusCode: executionRequest.simulatedWebhookStatusCode
            })
          })
        : undefined;
      const result = await executeApprovedCampaign({
        campaign,
        workbench,
        adapter: buildDeliveryAdapter(executionRequest),
        webhookDispatcher: dispatcher,
        replyAssessments: executionRequest.replyAssessments,
        incidents: executionRequest.incidents
      });
      const updated = await store.update(result.campaign);

      return {
        campaignId: updated.id,
        status: updated.status,
        summary: updated.summary,
        senderHealth: updated.senderHealth,
        adapterRiskPosture: result.deliveryAttempts[0]?.riskPosture ?? null,
        intents: result.intents,
        deliveryAttempts: result.deliveryAttempts,
        webhookDeliveries: result.webhookDeliveries,
        proofPack: result.proofPack
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/webhooks/preview", async (request) => {
    const payload = request.body ?? {};
    return {
      signature: signWebhookPayload(payload, webhookSecret),
      payload
    };
  });

  app.get("/openapi.json", async () => ({
    openapi: "3.1.0",
    info: {
      title: "Inschneidergram API",
      version: "0.1.0"
    },
    paths: {
      "/campaigns": {
        post: {
          summary: "Create an Instagram creator outreach campaign",
          responses: {
            "202": { description: "Campaign accepted and scheduled" },
            "400": { description: "Invalid campaign request" }
          }
        },
        get: {
          summary: "List campaigns"
        }
      },
      "/campaigns/{id}": {
        get: {
          summary: "Get campaign status"
        }
      },
      "/campaigns/{id}/events": {
        post: {
          summary: "Record provider delivery or reply event"
        }
      },
      "/campaigns/{id}/executions": {
        post: {
          summary: "Execute approved campaign targets through a mock or manual-safe adapter"
        }
      }
    }
  }));

  return app;
}

function sendDomainError(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: error.issues
    });
  }

  return reply.code(400).send({
    error: "invalid_request",
    message: error instanceof Error ? error.message : "Request could not be processed"
  });
}

const executionRequestSchema = z.object({
  approvals: z
    .object({
      approvedTargets: z.array(z.string().min(1)).optional(),
      rejectedTargets: z.array(z.string().min(1)).default([]),
      message: z.string().min(1).max(1000).optional(),
      actor: z.string().min(1).max(120).default("api")
    })
    .default({ rejectedTargets: [], actor: "api" }),
  adapter: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("mock"),
        restrictedTargets: z.array(z.string().min(1)).default([]),
        failingTargets: z.array(z.string().min(1)).default([]),
        replyTargets: z.array(z.string().min(1)).default([])
      }),
      z.object({
        kind: z.literal("manual")
      })
    ])
    .default({ kind: "mock", restrictedTargets: [], failingTargets: [], replyTargets: [] }),
  simulateWebhooks: z.boolean().default(true),
  simulatedWebhookStatusCode: z.number().int().min(100).max(599).default(204),
  replyAssessments: z
    .array(
      z.object({
        targetHandle: z.string().min(1),
        disposition: z.enum(["interested", "neutral", "not_interested", "opt_out", "complaint"]),
        qualified: z.boolean(),
        replyText: z.string().min(1).optional(),
        note: z.string().min(1).optional()
      })
    )
    .default([]),
  incidents: z
    .array(
      z.object({
        kind: z.enum([
          "sender_warning",
          "sender_restriction",
          "delivery_failure",
          "quality_issue",
          "opt_out",
          "complaint",
          "manual_note"
        ]),
        severity: z.enum(["info", "warning", "critical"]),
        at: z.string().datetime(),
        note: z.string().min(1),
        targetHandle: z.string().min(1).optional(),
        senderAccountId: z.string().min(1).optional()
      })
    )
    .default([])
});

type ExecutionRequest = z.infer<typeof executionRequestSchema>;

function buildApprovalWorkbench(
  campaign: Campaign,
  request: ExecutionRequest
) {
  const candidateTargets = uniqueTargets(
    campaign.targets
      .filter((target) => target.handle)
      .map((target) => target.handle as string)
  );
  let workbench = createApprovalWorkbench({
    campaignId: campaign.id,
    candidates: candidateTargets.map((target, index) => ({
      id: `candidate_${index + 1}`,
      target
    })),
    messages: [
      {
        id: "copy_1",
        body: request.approvals.message ?? campaign.message
      }
    ]
  });
  const approved = new Set(
    (request.approvals.approvedTargets ?? scheduledTargetHandles(campaign)).map(normalizeHandle)
  );
  const rejected = new Set(request.approvals.rejectedTargets.map(normalizeHandle));

  for (const candidate of workbench.candidates) {
    if (rejected.has(candidate.handle)) {
      workbench = rejectCandidate(workbench, {
        candidateId: candidate.id,
        actor: request.approvals.actor,
        reason: "Rejected through execution request"
      });
      continue;
    }

    if (approved.has(candidate.handle)) {
      workbench = approveCandidate(workbench, {
        candidateId: candidate.id,
        actor: request.approvals.actor,
        reason: "Approved through execution request"
      });
    }
  }

  return approveMessage(workbench, {
    messageId: "copy_1",
    actor: request.approvals.actor,
    reason: "Approved through execution request"
  });
}

function buildDeliveryAdapter(request: ExecutionRequest) {
  if (request.adapter.kind === "manual") {
    return createManualDeliveryAdapter();
  }

  return createMockDeliveryAdapter({
    restrictedTargets: request.adapter.restrictedTargets,
    failingTargets: request.adapter.failingTargets,
    replyTargets: request.adapter.replyTargets
  });
}

function scheduledTargetHandles(campaign: Campaign): string[] {
  return campaign.targets
    .filter((target) => target.status === "scheduled" && target.handle)
    .map((target) => target.handle as string);
}

function uniqueTargets(targets: string[]): string[] {
  return [...new Set(targets.map(normalizeHandle))];
}

function normalizeHandle(target: string): string {
  return normalizeInstagramHandle(target);
}

function withIdempotencyKey(body: unknown, headerValue: string | string[] | undefined): unknown {
  const headerKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!headerKey || typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  return {
    ...record,
    idempotencyKey:
      typeof record.idempotencyKey === "string" ? record.idempotencyKey : headerKey
  };
}
