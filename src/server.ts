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
  createMockDeliveryAdapter,
  recordManualDeliveryEvent,
  type DeliveryAttempt,
  type DeliveryEventType,
  type DeliveryOutcome
} from "./domain/delivery.js";
import { executeApprovedCampaign } from "./domain/execution.js";
import { normalizeInstagramHandle } from "./domain/handles.js";
import {
  createTargetWebhookJob,
  OutgoingWebhookDispatcher
} from "./domain/outgoingWebhook.js";
import { generatePilotProofPack, type ReplyAssessment } from "./domain/proofPack.js";
import {
  createCampaignExecutionRecord,
  InMemoryCampaignStore,
  type CampaignExecutionRecord,
  type CampaignStore
} from "./domain/store.js";
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
      const execution = await store.insertExecution(
        createCampaignExecutionRecord({
          campaignId: updated.id,
          adapterRiskPosture: result.deliveryAttempts[0]?.riskPosture ?? null,
          intents: result.intents,
          deliveryAttempts: result.deliveryAttempts,
          webhookDeliveries: result.webhookDeliveries,
          approvalWorkbench: workbench,
          replyAssessments: executionRequest.replyAssessments,
          incidents: executionRequest.incidents,
          proofPack: result.proofPack
        })
      );

      return {
        campaignId: updated.id,
        executionId: execution.id,
        status: updated.status,
        summary: updated.summary,
        senderHealth: updated.senderHealth,
        adapterRiskPosture: execution.adapterRiskPosture,
        intents: result.intents,
        deliveryAttempts: result.deliveryAttempts,
        webhookDeliveries: result.webhookDeliveries,
        proofPack: result.proofPack,
        execution
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/campaigns/:id/executions/:executionId/manual-events", async (request, reply) => {
    const { id, executionId } = request.params as { id: string; executionId: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    const execution = await store.getExecution(executionId);
    if (!execution || execution.campaignId !== id) {
      return reply.code(404).send({ error: "execution_not_found" });
    }

    try {
      const evidenceRequest = manualEvidenceRequestSchema.parse(
        withManualEventId(request.body, request.headers["idempotency-key"])
      );
      const result = await recordManualEvidence({
        campaign,
        execution,
        request: evidenceRequest,
        webhookSecret
      });
      const updatedCampaign = await store.update(result.campaign);
      const updatedExecution = await store.insertExecution(result.execution);

      return {
        campaignId: updatedCampaign.id,
        executionId: updatedExecution.id,
        status: updatedCampaign.status,
        summary: updatedCampaign.summary,
        senderHealth: updatedCampaign.senderHealth,
        event: result.event,
        webhookDelivery: result.webhookDelivery,
        execution: updatedExecution,
        proofPack: updatedExecution.proofPack
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/campaigns/:id/executions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    return {
      campaignId: id,
      executions: await store.listExecutions(id)
    };
  });

  app.get("/campaigns/:id/executions/:executionId", async (request, reply) => {
    const { id, executionId } = request.params as { id: string; executionId: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    const execution = await store.getExecution(executionId);
    if (!execution || execution.campaignId !== id) {
      return reply.code(404).send({ error: "execution_not_found" });
    }

    return execution;
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["targets", "campaign"],
                  properties: {
                    targets: {
                      type: "array",
                      items: { type: "string" },
                      minItems: 1
                    },
                    message: { type: "string" },
                    campaign: { type: "string" },
                    settings: {
                      type: "object",
                      properties: {
                        senderPool: {
                          type: "array",
                          items: { type: "string" }
                        },
                        webhookUrl: { type: "string", format: "uri" },
                        dryRun: { type: "boolean" }
                      }
                    }
                  }
                }
              }
            }
          },
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
          summary: "Record provider delivery or reply event",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["target", "event"],
                  properties: {
                    target: { type: "string" },
                    event: {
                      type: "string",
                      enum: ["sent", "delivered", "reply", "failed"]
                    },
                    eventId: { type: "string" },
                    messageId: { type: "string" },
                    error: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Campaign event recorded" },
            "400": { description: "Invalid event request" },
            "404": { description: "Campaign not found" }
          }
        }
      },
      "/campaigns/{id}/executions": {
        get: {
          summary: "List persisted execution proof records for a campaign",
          responses: {
            "200": { description: "Execution proof records returned" },
            "404": { description: "Campaign not found" }
          }
        },
        post: {
          summary: "Execute approved campaign targets through a mock or manual-safe adapter",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    approvals: {
                      type: "object",
                      properties: {
                        approvedTargets: {
                          type: "array",
                          items: { type: "string" }
                        },
                        rejectedTargets: {
                          type: "array",
                          items: { type: "string" }
                        },
                        message: { type: "string" },
                        actor: { type: "string" }
                      }
                    },
                    adapter: {
                      oneOf: [
                        {
                          type: "object",
                          required: ["kind"],
                          properties: {
                            kind: { const: "mock" },
                            restrictedTargets: {
                              type: "array",
                              items: { type: "string" }
                            },
                            failingTargets: {
                              type: "array",
                              items: { type: "string" }
                            },
                            replyTargets: {
                              type: "array",
                              items: { type: "string" }
                            }
                          }
                        },
                        {
                          type: "object",
                          required: ["kind"],
                          properties: {
                            kind: { const: "manual" }
                          }
                        }
                      ]
                    },
                    simulateWebhooks: { type: "boolean" },
                    simulatedWebhookStatusCode: { type: "integer" },
                    replyAssessments: {
                      type: "array",
                      items: { type: "object" }
                    },
                    incidents: {
                      type: "array",
                      items: { type: "object" }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Safe execution completed and proof pack returned"
            },
            "400": { description: "Invalid execution request" },
            "404": { description: "Campaign not found" }
          }
        }
      },
      "/campaigns/{id}/executions/{executionId}": {
        get: {
          summary: "Get one persisted execution proof record",
          responses: {
            "200": { description: "Execution proof record returned" },
            "404": { description: "Campaign or execution not found" }
          }
        }
      },
      "/campaigns/{id}/executions/{executionId}/manual-events": {
        post: {
          summary: "Record manual evidence for one execution intent",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["type", "evidence"],
                  properties: {
                    eventId: { type: "string" },
                    intentId: { type: "string" },
                    target: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["sent", "failed", "restricted", "replied"]
                    },
                    occurredAt: { type: "string", format: "date-time" },
                    messageId: { type: "string" },
                    reason: { type: "string" },
                    replyText: { type: "string" },
                    evidence: {
                      type: "object",
                      additionalProperties: { type: "string" }
                    },
                    replyAssessment: { type: "object" },
                    simulatedWebhookStatusCode: { type: "integer" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Manual evidence recorded and proof pack refreshed" },
            "400": { description: "Invalid manual evidence request" },
            "404": { description: "Campaign, execution, or intent not found" },
            "409": { description: "Execution or manual event state conflict" }
          }
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
  if (error instanceof NotFoundError) {
    return reply.code(404).send({
      error: "not_found",
      message: error.message
    });
  }
  if (error instanceof ConflictError) {
    return reply.code(409).send({
      error: "conflict",
      message: error.message
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

const manualEvidenceRequestSchema = z
  .object({
    eventId: z.string().min(1).max(200).optional(),
    intentId: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    type: z.enum(["sent", "failed", "restricted", "replied"]),
    occurredAt: z.string().datetime().optional(),
    messageId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    replyText: z.string().min(1).optional(),
    evidence: z.record(z.string(), z.string()).default({}),
    replyAssessment: z
      .object({
        disposition: z.enum(["interested", "neutral", "not_interested", "opt_out", "complaint"]),
        qualified: z.boolean(),
        replyText: z.string().min(1).optional(),
        note: z.string().min(1).optional()
      })
      .optional(),
    simulatedWebhookStatusCode: z.number().int().min(100).max(599).default(204)
  })
  .superRefine((value, ctx) => {
    if (!value.intentId && !value.target) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either intentId or target",
        path: ["intentId"]
      });
    }
  });

type ManualEvidenceRequest = z.infer<typeof manualEvidenceRequestSchema>;

class NotFoundError extends Error {}
class ConflictError extends Error {}

async function recordManualEvidence(input: {
  campaign: Campaign;
  execution: CampaignExecutionRecord;
  request: ManualEvidenceRequest;
  webhookSecret: string;
}): Promise<{
  campaign: Campaign;
  execution: CampaignExecutionRecord;
  event: DeliveryAttempt["events"][number];
  webhookDelivery: Awaited<ReturnType<OutgoingWebhookDispatcher["dispatch"]>> | null;
}> {
  if (input.execution.adapterRiskPosture?.kind !== "manual") {
    throw new ConflictError("Manual evidence can only be recorded for manual executions");
  }

  const deliveryAttempts = structuredClone(input.execution.deliveryAttempts);
  const attempt = findManualAttempt(deliveryAttempts, input.request);
  const existingEvent = input.request.eventId
    ? attempt.events.find((candidate) => candidate.id === input.request.eventId)
    : undefined;
  if (existingEvent) {
    return {
      campaign: input.campaign,
      execution: input.execution,
      event: existingEvent,
      webhookDelivery: null
    };
  }

  assertManualTransition(attempt, input.request.type);

  const adapter = createManualDeliveryAdapter(attempt.adapterId);
  const recordedEvent = recordManualDeliveryEvent(adapter, attempt.intent, {
    type: input.request.type,
    occurredAt: input.request.occurredAt,
    messageId: input.request.messageId,
    reason: input.request.reason,
    replyText: input.request.replyText,
    evidence: input.request.evidence
  });
  const event = {
    ...recordedEvent,
    id: input.request.eventId ?? recordedEvent.id
  };
  attempt.events.push(event);
  attempt.outcome = outcomeForManualEvents(attempt.events.map((candidate) => candidate.type));

  const campaign = recordTargetEvent(input.campaign, {
    target: attempt.intent.targetHandle,
    event: campaignEventForManualEvidence(input.request.type),
    eventId: event.id,
    messageId: event.messageId,
    error: event.reason,
    receivedAt: event.occurredAt
  });

  const webhookDelivery = await dispatchSimulatedWebhook({
    campaign,
    targetHandle: attempt.intent.targetHandle,
    webhookSecret: input.webhookSecret,
    statusCode: input.request.simulatedWebhookStatusCode
  });
  const webhookDeliveries = webhookDelivery
    ? [...input.execution.webhookDeliveries, webhookDelivery]
    : [...input.execution.webhookDeliveries];
  const replyAssessments = appendReplyAssessment(
    input.execution.replyAssessments ?? [],
    attempt.intent.targetHandle,
    input.request
  );

  return {
    campaign,
    execution: {
      ...input.execution,
      deliveryAttempts,
      webhookDeliveries,
      replyAssessments,
      proofPack: generatePilotProofPack({
        campaign,
        approvalWorkbench: input.execution.approvalWorkbench,
        deliveryAttempts,
        webhookDeliveries,
        replyAssessments,
        incidents: input.execution.incidents ?? []
      })
    },
    event,
    webhookDelivery
  };
}

function findManualAttempt(
  attempts: DeliveryAttempt[],
  request: ManualEvidenceRequest
): DeliveryAttempt {
  const targetHandle = request.target ? normalizeHandle(request.target) : undefined;
  const attempt = attempts.find((candidate) => {
    if (request.intentId && candidate.intent.id === request.intentId) {
      return true;
    }

    return !!targetHandle && candidate.intent.targetHandle === targetHandle;
  });

  if (!attempt) {
    throw new NotFoundError("Execution intent not found for manual evidence");
  }
  if (attempt.riskPosture.kind !== "manual") {
    throw new ConflictError("Manual evidence can only be recorded for manual delivery attempts");
  }

  return attempt;
}

function assertManualTransition(attempt: DeliveryAttempt, type: DeliveryEventType): void {
  const existing = new Set(attempt.events.map((event) => event.type));

  if (existing.has("failed") || existing.has("restricted")) {
    throw new ConflictError("Manual evidence already recorded a terminal failure for this target");
  }
  if (existing.has(type)) {
    throw new ConflictError(`Manual ${type} evidence already recorded for this target`);
  }
  if (type === "sent" && existing.has("replied")) {
    throw new ConflictError("Manual reply evidence is already recorded for this target");
  }
  if (type === "replied" && !existing.has("sent")) {
    throw new ConflictError("Manual reply evidence requires sent evidence first");
  }
  if ((type === "failed" || type === "restricted") && existing.size > 0) {
    throw new ConflictError("Manual failure evidence must be recorded before sent or reply evidence");
  }
}

function outcomeForManualEvents(types: DeliveryEventType[]): DeliveryOutcome {
  if (types.some((type) => type === "failed" || type === "restricted")) {
    return "rejected";
  }
  if (types.some((type) => type === "sent" || type === "replied")) {
    return "accepted";
  }

  return "needs_manual_evidence";
}

function campaignEventForManualEvidence(type: DeliveryEventType): "sent" | "reply" | "failed" {
  if (type === "replied") {
    return "reply";
  }
  if (type === "failed" || type === "restricted") {
    return "failed";
  }

  return "sent";
}

async function dispatchSimulatedWebhook(input: {
  campaign: Campaign;
  targetHandle: string;
  webhookSecret: string;
  statusCode: number;
}): Promise<Awaited<ReturnType<OutgoingWebhookDispatcher["dispatch"]>> | null> {
  const target = input.campaign.targets.find((candidate) => candidate.handle === input.targetHandle);
  if (!target) {
    return null;
  }

  const job = createTargetWebhookJob(input.campaign, target);
  if (!job) {
    return null;
  }

  const dispatcher = new OutgoingWebhookDispatcher({
    secret: input.webhookSecret,
    sender: async () => ({
      statusCode: input.statusCode
    })
  });
  return dispatcher.dispatch(job);
}

function appendReplyAssessment(
  existing: ReplyAssessment[],
  targetHandle: string,
  request: ManualEvidenceRequest
): ReplyAssessment[] {
  if (request.type !== "replied" || !request.replyAssessment) {
    return [...existing];
  }

  return [
    ...existing,
    {
      targetHandle,
      disposition: request.replyAssessment.disposition,
      qualified: request.replyAssessment.qualified,
      replyText: request.replyAssessment.replyText ?? request.replyText,
      note: request.replyAssessment.note
    }
  ];
}

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

function withManualEventId(body: unknown, headerValue: string | string[] | undefined): unknown {
  const headerKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!headerKey || typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  return {
    ...record,
    eventId: typeof record.eventId === "string" ? record.eventId : headerKey
  };
}
