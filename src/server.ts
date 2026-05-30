import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import {
  approveCandidate,
  approveMessage,
  blockCandidate,
  claimCandidate,
  createApprovalWorkbench,
  rejectCandidate,
  rejectMessage,
  skipCandidate,
  type ApprovalWorkbench
} from "./domain/approval.js";
import {
  createCampaign,
  recordTargetEvent,
  targetEventSchema,
  type Campaign,
  type CampaignTarget
} from "./domain/campaign.js";
import {
  createManagedProviderDeliveryAdapter,
  createManualDeliveryAdapter,
  createMockDeliveryAdapter,
  recordManualDeliveryEvent,
  type DeliveryAttempt,
  type DeliveryEventType,
  type DeliveryOutcome,
  type ManualEvidenceRequirement
} from "./domain/delivery.js";
import { executeApprovedCampaign } from "./domain/execution.js";
import { normalizeInstagramHandle } from "./domain/handles.js";
import {
  createTargetWebhookJob,
  OutgoingWebhookDispatcher,
  type OutgoingWebhookRequest,
  type OutgoingWebhookSender,
  type OutgoingWebhookSenderResult,
  type WebhookDeliveryRecord
} from "./domain/outgoingWebhook.js";
import { generatePilotProofPack, type ReplyAssessment } from "./domain/proofPack.js";
import {
  createCampaignExecutionRecord,
  InMemoryCampaignStore,
  type CampaignExecutionRecord,
  type CampaignStore
} from "./domain/store.js";
import { buildPilotReadinessReport } from "./domain/readiness.js";
import {
  createSenderAccount,
  summarizeSenderInventory,
  type SenderAccount
} from "./domain/sender.js";
import { signWebhookPayload } from "./domain/webhook.js";

export interface ServerOptions {
  store?: CampaignStore;
  webhookSecret?: string;
  provider?: string;
  apiKey?: string;
  webhookSender?: OutgoingWebhookSender;
  webhookAllowedHosts?: string[];
  webhookDnsLookup?: WebhookDnsLookup;
}

interface WebhookDestinationPolicy {
  allowedHosts: string[];
  dnsLookup?: WebhookDnsLookup;
}

export interface WebhookDnsAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookDnsLookup = (hostname: string) => Promise<WebhookDnsAddress[]>;

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? new InMemoryCampaignStore();
  const webhookSecret = options.webhookSecret ?? "dev-secret";
  const provider = options.provider ?? process.env.INSCHNEIDERGRAM_PROVIDER ?? "mock";
  const apiKey = normalizeOptionalApiKey(options.apiKey);
  const runtimeSender = options.webhookSender ?? sendOutgoingWebhook;
  const webhookDestinationPolicy = createWebhookDestinationPolicy(
    options.webhookAllowedHosts ?? [],
    {
      dnsLookup:
        options.webhookDnsLookup ??
        (options.webhookSender ? undefined : lookupWebhookHostname)
    }
  );
  const runtimeWebhookDispatcher = new OutgoingWebhookDispatcher({
    secret: webhookSecret,
    sender: guardedWebhookSender(
      webhookDestinationPolicy,
      runtimeSender
    )
  });
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true,
    allowedHeaders: ["authorization", "x-api-key", "content-type", "idempotency-key"]
  });

  if (apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (isPublicRequest(request.method, request.url)) {
        return;
      }

      const providedKeys = extractApiKeyCandidates(request.headers);
      if (!providedKeys.some((providedKey) => apiKeysEqual(providedKey, apiKey))) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Valid API key required"
        });
      }
    });
  }

  app.get("/health", async (_request, reply) => {
    const storeHealth = await store.healthCheck();
    return reply.code(storeHealth.ok ? 200 : 503).send({
      ok: storeHealth.ok,
      service: "inschneidergram",
      provider,
      store: storeHealth
    });
  });

  app.get("/operator/manual-queue", async (request, reply) => {
    try {
      return await buildOperatorManualQueue(
        store,
        manualQueueQuerySchema.parse(request.query ?? {})
      );
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/senders", async () => {
    const senderAccounts = await store.listSenderAccounts();
    return {
      senderAccounts,
      senderHealth: summarizeSenderInventory(senderAccounts)
    };
  });

  app.get("/senders/health", async () => ({
    senderHealth: summarizeSenderInventory(await store.listSenderAccounts())
  }));

  app.get("/senders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const senderAccount = await store.getSenderAccount(id);

    if (!senderAccount) {
      return reply.code(404).send({ error: "sender_account_not_found" });
    }

    return {
      senderAccount,
      senderHealth: summarizeSenderInventory([senderAccount])
    };
  });

  app.put("/senders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const parsed = senderAccountRequestSchema.parse(request.body ?? {});
      const existing = await store.getSenderAccount(id);
      const status = parsed.status ?? existing?.status ?? "healthy";
      const preserveExistingState = parsed.status === undefined;
      const saved = await store.upsertSenderAccount(
        createSenderAccount({
          id,
          status,
          dailyLimit: parsed.dailyLimit,
          cooldownUntil:
            parsed.cooldownUntil ?? (preserveExistingState ? existing?.cooldownUntil : undefined),
          warmupNote: parsed.warmupNote ?? existing?.warmupNote,
          riskEvents: parsed.riskEvents ?? existing?.riskEvents ?? []
        })
      );
      return {
        senderAccount: saved,
        senderHealth: summarizeSenderInventory(await store.listSenderAccounts())
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/senders/:id/risk-events", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const saved = await store.appendSenderRiskEvent(
        id,
        senderRiskEventRequestSchema.parse(request.body ?? {})
      );
      if (!saved) {
        return reply.code(404).send({ error: "sender_account_not_found" });
      }
      return {
        senderAccount: saved,
        senderHealth: summarizeSenderInventory(await store.listSenderAccounts())
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/campaigns", async (request, reply) => {
    try {
      const campaignInput = await withStoredSenderInventory(
        store,
        withIdempotencyKey(request.body, request.headers["idempotency-key"])
      );
      assertWebhookDestinationFromCampaignInput(campaignInput, webhookDestinationPolicy);
      const campaign = await store.insert(
        createCampaign(campaignInput)
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

  app.get("/campaigns/:id/readiness", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    return buildPilotReadinessReport({
      campaign: await withCurrentSenderInventorySnapshot(store, campaign),
      approvalWorkbench: await store.getApprovalWorkbench(id),
      executions: await store.listExecutions(id)
    });
  });

  app.get("/campaigns/:id/proof-pack", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    const report = await buildLatestProofPackReport(store, campaign);
    if (!report) {
      const campaignForReadiness = await withCurrentSenderInventorySnapshot(store, campaign);
      return reply.code(404).send({
        error: "proof_pack_not_found",
        message: "No execution proof record exists for this campaign yet.",
        campaignId: id,
        readiness: buildPilotReadinessReport({
          campaign: campaignForReadiness,
          approvalWorkbench: await store.getApprovalWorkbench(id),
          executions: []
        })
      });
    }

    return report;
  });

  app.post("/campaigns/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    try {
      const event = targetEventSchema.parse(request.body ?? {});
      const campaignBeforeEvent = structuredClone(campaign);
      const updated = await store.update(recordTargetEvent(campaign, event));
      const webhookTarget = targetWithNewEvent(campaignBeforeEvent, updated, event.target);
      const webhookDelivery = webhookTarget
        ? await dispatchTargetWebhook(runtimeWebhookDispatcher, updated, webhookTarget)
        : null;
      return {
        campaignId: updated.id,
        status: updated.status,
        summary: updated.summary,
        senderHealth: updated.senderHealth,
        webhookDelivery
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/campaigns/:id/approval-workbench", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    try {
      const approvalRequest = approvalWorkbenchRequestSchema.parse(request.body ?? {});
      const workbench = await store.upsertApprovalWorkbench(
        buildStoredApprovalWorkbench(campaign, approvalRequest)
      );

      return {
        campaignId: campaign.id,
        approvalWorkbench: workbench
      };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/campaigns/:id/approval-workbench", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    const workbench = await store.getApprovalWorkbench(id);
    if (!workbench) {
      return reply.code(404).send({ error: "approval_workbench_not_found" });
    }

    return {
      campaignId: id,
      approvalWorkbench: workbench
    };
  });

  app.post(
    "/campaigns/:id/approval-workbench/candidates/:candidateId/decision",
    async (request, reply) => {
      const { id, candidateId } = request.params as { id: string; candidateId: string };
      const campaign = await store.get(id);

      if (!campaign) {
        return reply.code(404).send({ error: "campaign_not_found" });
      }

      const workbench = await store.getApprovalWorkbench(id);
      if (!workbench) {
        return reply.code(404).send({ error: "approval_workbench_not_found" });
      }

      try {
        const decision = approvalDecisionRequestSchema.parse(request.body ?? {});
        const updated =
          decision.decision === "approved"
            ? approveCandidate(workbench, {
                candidateId,
                actor: decision.actor,
                reason: decision.reason
              })
            : rejectCandidate(workbench, {
                candidateId,
                actor: decision.actor,
                reason: decision.reason
              });
        const saved = await store.upsertApprovalWorkbench(updated);

        return {
          campaignId: id,
          approvalWorkbench: saved
        };
      } catch (error) {
        return sendDomainError(reply, error);
      }
    }
  );

  app.post(
    "/campaigns/:id/approval-workbench/messages/:messageId/decision",
    async (request, reply) => {
      const { id, messageId } = request.params as { id: string; messageId: string };
      const campaign = await store.get(id);

      if (!campaign) {
        return reply.code(404).send({ error: "campaign_not_found" });
      }

      const workbench = await store.getApprovalWorkbench(id);
      if (!workbench) {
        return reply.code(404).send({ error: "approval_workbench_not_found" });
      }

      try {
        const decision = approvalDecisionRequestSchema.parse(request.body ?? {});
        const updated =
          decision.decision === "approved"
            ? approveMessage(workbench, {
                messageId,
                actor: decision.actor,
                reason: decision.reason
              })
            : rejectMessage(workbench, {
                messageId,
                actor: decision.actor,
                reason: decision.reason
              });
        const saved = await store.upsertApprovalWorkbench(updated);

        return {
          campaignId: id,
          approvalWorkbench: saved
        };
      } catch (error) {
        return sendDomainError(reply, error);
      }
    }
  );

  app.post(
    "/campaigns/:id/approval-workbench/candidates/:candidateId/claim",
    async (request, reply) => {
      const { id, candidateId } = request.params as { id: string; candidateId: string };
      const campaign = await store.get(id);

      if (!campaign) {
        return reply.code(404).send({ error: "campaign_not_found" });
      }

      const workbench = await store.getApprovalWorkbench(id);
      if (!workbench) {
        return reply.code(404).send({ error: "approval_workbench_not_found" });
      }

      try {
        const claim = operatorClaimRequestSchema.parse(request.body ?? {});
        const saved = await store.upsertApprovalWorkbench(
          claimCandidate(workbench, {
            candidateId,
            operator: claim.operator
          })
        );

        return {
          campaignId: id,
          approvalWorkbench: saved
        };
      } catch (error) {
        return sendDomainError(reply, error);
      }
    }
  );

  app.post(
    "/campaigns/:id/approval-workbench/candidates/:candidateId/work",
    async (request, reply) => {
      const { id, candidateId } = request.params as { id: string; candidateId: string };
      const campaign = await store.get(id);

      if (!campaign) {
        return reply.code(404).send({ error: "campaign_not_found" });
      }

      const workbench = await store.getApprovalWorkbench(id);
      if (!workbench) {
        return reply.code(404).send({ error: "approval_workbench_not_found" });
      }

      try {
        const terminal = operatorTerminalRequestSchema.parse(request.body ?? {});
        const updated =
          terminal.work === "skipped"
            ? skipCandidate(workbench, {
                candidateId,
                operator: terminal.operator,
                reason: terminal.reason,
                evidence: terminal.evidence
              })
            : blockCandidate(workbench, {
                candidateId,
                operator: terminal.operator,
                reason: terminal.reason,
                evidence: terminal.evidence
              });
        const saved = await store.upsertApprovalWorkbench(updated);

        return {
          campaignId: id,
          approvalWorkbench: saved
        };
      } catch (error) {
        return sendDomainError(reply, error);
      }
    }
  );

  app.post("/campaigns/:id/executions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    try {
      const executionRequest = executionRequestSchema.parse(request.body ?? {});
      const campaignForExecution = await withCurrentSenderInventorySnapshot(store, campaign);
      const storedWorkbench = await store.getApprovalWorkbench(id);
      const existingExecutions = await store.listExecutions(id);
      if (!storedWorkbench && !hasInlineApprovalOverrides(executionRequest)) {
        assertExecutionReadiness(campaignForExecution, null, existingExecutions);
      }
      const workbench = buildExecutionApprovalWorkbench(
        campaignForExecution,
        executionRequest,
        storedWorkbench
      );
      assertExecutionReadiness(
        campaignForExecution,
        workbench,
        existingExecutions
      );
      validateManagedProviderOutcomes(campaignForExecution, workbench, executionRequest);
      assertCurrentSenderAvailability(campaignForExecution, workbench);
      const dispatcher = executionRequest.simulateWebhooks
        ? new OutgoingWebhookDispatcher({
            secret: webhookSecret,
            sender: async () => ({
              statusCode: executionRequest.simulatedWebhookStatusCode
            })
          })
        : runtimeWebhookDispatcher;
      const result = await executeApprovedCampaign({
        campaign: campaignForExecution,
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
      const result = await store.updateCampaignExecution(id, executionId, async (currentCampaign, currentExecution) => {
        const evidenceResult = await recordManualEvidence({
          campaign: currentCampaign,
          execution: currentExecution,
          request: evidenceRequest,
          webhookSecret
        });
        return {
          campaign: evidenceResult.campaign,
          execution: evidenceResult.execution,
          result: evidenceResult
        };
      });

      if (!result) {
        return reply.code(404).send({ error: "execution_not_found" });
      }

      return {
        campaignId: result.campaign.id,
        executionId: result.execution.id,
        status: result.campaign.status,
        summary: result.campaign.summary,
        senderHealth: result.campaign.senderHealth,
        event: result.event,
        webhookDelivery: result.webhookDelivery,
        execution: result.execution,
        proofPack: result.execution.proofPack
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

  app.get("/campaigns/:id/executions/:executionId/manual-queue", async (request, reply) => {
    const { id, executionId } = request.params as { id: string; executionId: string };
    const campaign = await store.get(id);

    if (!campaign) {
      return reply.code(404).send({ error: "campaign_not_found" });
    }

    const execution = await store.getExecution(executionId);
    if (!execution || execution.campaignId !== id) {
      return reply.code(404).send({ error: "execution_not_found" });
    }

    return buildManualDeliveryQueue(execution, campaign);
  });

  app.get("/webhooks/dead-letters", async () => ({
    deadLetters: runtimeWebhookDispatcher.deadLetters()
  }));

  app.post("/webhooks/dead-letters/:id/replay", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const replayed = runtimeWebhookDispatcher.replay(id);
      await runtimeWebhookDispatcher.drainDue();
      return {
        replayed,
        delivery: runtimeWebhookDispatcher.get(id)
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
      version: "0.1.0",
      description:
        "Deployments can require X-API-Key or Authorization: Bearer credentials through INSCHNEIDERGRAM_API_KEY. /health, /openapi.json, and CORS preflight remain public."
    },
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key"
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer"
        }
      }
    },
    paths: {
      "/health": {
        get: {
          summary: "Check API health",
          security: [],
          responses: {
            "200": { description: "Service and store health returned" },
            "503": { description: "Service is running but the store is unhealthy" }
          }
        }
      },
      "/openapi.json": {
        get: {
          summary: "Fetch the OpenAPI contract",
          security: [],
          responses: {
            "200": { description: "OpenAPI contract returned" }
          }
        }
      },
      "/operator/manual-queue": {
        get: {
          summary: "List actionable manual delivery work across campaigns",
          parameters: openApiManualQueueQueryParameters(),
          responses: {
            "200": { description: "Operator manual delivery queue returned" },
            "400": { description: "Invalid manual queue filter" }
          }
        }
      },
      "/senders": {
        get: {
          summary: "List managed sender accounts and inventory health",
          responses: {
            "200": {
              description: "Managed sender inventory returned"
            }
          }
        }
      },
      "/senders/health": {
        get: {
          summary: "Inspect managed sender inventory health",
          responses: {
            "200": {
              description: "Managed sender inventory health returned"
            }
          }
        }
      },
      "/senders/{id}": {
        parameters: openApiPathParameters("id"),
        get: {
          summary: "Get one managed sender account",
          responses: {
            "200": { description: "Managed sender account returned" },
            "404": { description: "Sender account not found" }
          }
        },
        put: {
          summary: "Create or update one managed sender account",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiSenderAccountRequestSchema()
              }
            }
          },
          responses: {
            "200": { description: "Managed sender account persisted" },
            "400": { description: "Invalid sender account request" }
          }
        }
      },
      "/senders/{id}/risk-events": {
        parameters: openApiPathParameters("id"),
        post: {
          summary: "Append a sender account risk event",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiSenderRiskEventRequestSchema()
              }
            }
          },
          responses: {
            "200": { description: "Sender risk event appended" },
            "400": { description: "Invalid sender risk event request" },
            "404": { description: "Sender account not found" }
          }
        }
      },
      "/campaigns": {
        post: {
          summary: "Create an Instagram creator outreach campaign",
          parameters: [openApiIdempotencyHeader()],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["targets", "campaign"],
                  oneOf: [{ required: ["message"] }, { required: ["template"] }],
                  properties: {
                    targets: {
                      type: "array",
                      items: { type: "string" },
                      minItems: 1
                    },
                    message: { type: "string" },
                    template: {
                      type: "object",
                      required: ["body"],
                      properties: {
                        body: { type: "string" },
                        variables: {
                          type: "object",
                          additionalProperties: { type: "string" }
                        }
                      }
                    },
                    campaign: { type: "string" },
                    metadata: {
                      type: "object",
                      additionalProperties: true
                    },
                    settings: {
                      type: "object",
                      properties: {
                        dailyLimitPerSender: { type: "integer", minimum: 1, maximum: 200 },
                        minDelaySeconds: { type: "integer", minimum: 10, maximum: 86400 },
                        maxDelaySeconds: { type: "integer", minimum: 10, maximum: 86400 },
                        senderPool: {
                          type: "array",
                          items: { type: "string" }
                        },
                        senderAccounts: {
                          type: "array",
                          items: openApiSenderAccountSchema()
                        },
                        webhookUrl: {
                          type: "string",
                          format: "uri",
                          description:
                            "Public HTTPS callback URL. Localhost, private-network, and non-allowlisted hosts are rejected."
                        },
                        dryRun: { type: "boolean" },
                        followUps: {
                          type: "array",
                          maxItems: 5,
                          items: {
                            type: "object",
                            required: ["delayHours", "message"],
                            properties: {
                              delayHours: { type: "integer", minimum: 1, maximum: 168 },
                              message: { type: "string" }
                            }
                          }
                        }
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
        parameters: openApiPathParameters("id"),
        get: {
          summary: "Get campaign status"
        }
      },
      "/campaigns/{id}/readiness": {
        parameters: openApiPathParameters("id"),
        get: {
          summary: "Get pilot launch readiness gates",
          responses: {
            "200": { description: "Pilot readiness report returned" },
            "404": { description: "Campaign not found" }
          }
        }
      },
      "/campaigns/{id}/proof-pack": {
        parameters: openApiPathParameters("id"),
        get: {
          summary: "Export the latest campaign proof pack and readiness context",
          responses: {
            "200": { description: "Latest proof pack report returned" },
            "404": { description: "Campaign or proof pack not found" }
          }
        }
      },
      "/campaigns/{id}/events": {
        parameters: openApiPathParameters("id"),
        post: {
          summary: "Record provider delivery or reply event and dispatch callback",
          description:
            "Updates campaign target status and, when settings.webhookUrl exists, dispatches one signed outgoing webhook for newly recorded event ids. Duplicate event ids return webhookDelivery null.",
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
            "200": { description: "Campaign event recorded with webhook delivery state" },
            "400": { description: "Invalid event request" },
            "404": { description: "Campaign not found" }
          }
        }
      },
      "/campaigns/{id}/approval-workbench": {
        parameters: openApiPathParameters("id"),
        post: {
          summary: "Create or replace a persisted approval workbench",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
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
                    approveMessage: { type: "boolean" },
                    actor: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Approval workbench persisted" },
            "400": { description: "Invalid approval workbench request" },
            "404": { description: "Campaign not found" }
          }
        },
        get: {
          summary: "Get the persisted approval workbench for a campaign",
          responses: {
            "200": { description: "Approval workbench returned" },
            "404": { description: "Campaign or approval workbench not found" }
          }
        }
      },
      "/campaigns/{id}/approval-workbench/candidates/{candidateId}/decision": {
        parameters: openApiPathParameters("id", "candidateId"),
        post: {
          summary: "Approve or reject one creator candidate",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["decision"],
                  properties: {
                    decision: { type: "string", enum: ["approved", "rejected"] },
                    actor: { type: "string" },
                    reason: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Candidate decision persisted" },
            "400": { description: "Invalid candidate decision" },
            "404": { description: "Campaign or approval workbench not found" }
          }
        }
      },
      "/campaigns/{id}/approval-workbench/messages/{messageId}/decision": {
        parameters: openApiPathParameters("id", "messageId"),
        post: {
          summary: "Approve or reject one message candidate",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["decision"],
                  properties: {
                    decision: { type: "string", enum: ["approved", "rejected"] },
                    actor: { type: "string" },
                    reason: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Message decision persisted" },
            "400": { description: "Invalid message decision" },
            "404": { description: "Campaign or approval workbench not found" }
          }
        }
      },
      "/campaigns/{id}/approval-workbench/candidates/{candidateId}/claim": {
        parameters: openApiPathParameters("id", "candidateId"),
        post: {
          summary: "Claim one approved creator candidate for operator work",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["operator"],
                  properties: {
                    operator: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Candidate claim persisted" },
            "400": { description: "Invalid candidate claim" },
            "404": { description: "Campaign or approval workbench not found" }
          }
        }
      },
      "/campaigns/{id}/approval-workbench/candidates/{candidateId}/work": {
        parameters: openApiPathParameters("id", "candidateId"),
        post: {
          summary: "Mark one claimed creator candidate skipped or blocked",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["work", "operator", "reason"],
                  properties: {
                    work: { type: "string", enum: ["skipped", "blocked"] },
                    operator: { type: "string" },
                    reason: { type: "string" },
                    evidence: {
                      type: "object",
                      properties: {
                        source: { type: "string" },
                        reference: { type: "string" },
                        note: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Candidate terminal work state persisted" },
            "400": { description: "Invalid candidate work state" },
            "404": { description: "Campaign or approval workbench not found" }
          }
        }
      },
      "/campaigns/{id}/executions": {
        parameters: openApiPathParameters("id"),
        get: {
          summary: "List persisted execution proof records for a campaign",
          responses: {
            "200": { description: "Execution proof records returned" },
            "404": { description: "Campaign not found" }
          }
        },
        post: {
          summary: "Execute approved campaign targets through a mock, manual-safe, or managed-provider adapter",
          description:
            "simulateWebhooks defaults to true for local rehearsals. Set simulateWebhooks=false to dispatch signed callbacks through the runtime webhook sender.",
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
                        },
                        {
                          type: "object",
                          required: ["kind", "outcomes"],
                          properties: {
                            kind: { const: "managed_provider" },
                            id: { type: "string" },
                            accountRiskOwner: {
                              type: "string",
                              enum: ["operator", "provider"]
                            },
                            requiresHumanEvidence: { type: "boolean" },
                            notes: {
                              type: "array",
                              items: { type: "string" }
                            },
                            outcomes: {
                              type: "array",
                              minItems: 1,
                              items: {
                                type: "object",
                                required: ["target", "outcome", "events"],
                                properties: {
                                  target: { type: "string" },
                                  outcome: {
                                    type: "string",
                                    enum: ["accepted", "rejected"]
                                  },
                                  events: {
                                    type: "array",
                                    minItems: 1,
                                    items: {
                                      type: "object",
                                      required: ["type"],
                                      properties: {
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
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
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
        parameters: openApiPathParameters("id", "executionId"),
        get: {
          summary: "Get one persisted execution proof record",
          responses: {
            "200": { description: "Execution proof record returned" },
            "404": { description: "Campaign or execution not found" }
          }
        }
      },
      "/campaigns/{id}/executions/{executionId}/manual-queue": {
        parameters: openApiPathParameters("id", "executionId"),
        get: {
          summary: "List manual delivery work for one execution",
          responses: {
            "200": { description: "Manual delivery queue returned" },
            "404": { description: "Campaign or execution not found" }
          }
        }
      },
      "/campaigns/{id}/executions/{executionId}/manual-events": {
        parameters: openApiPathParameters("id", "executionId"),
        post: {
          summary: "Record manual evidence for one execution intent",
          description:
            "Records operator evidence for a manual-safe execution. Webhook delivery in this route is simulated by the API process until a live dispatcher is configured.",
          parameters: [openApiIdempotencyHeader()],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiManualEvidenceSchema()
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
      },
      "/webhooks/dead-letters": {
        get: {
          summary: "List dead-lettered outgoing webhook deliveries",
          responses: {
            "200": { description: "Dead-lettered webhook deliveries returned" }
          }
        }
      },
      "/webhooks/dead-letters/{id}/replay": {
        parameters: openApiPathParameters("id"),
        post: {
          summary: "Replay one dead-lettered outgoing webhook delivery",
          responses: {
            "200": { description: "Webhook replay attempted and delivery state returned" },
            "400": { description: "Webhook delivery is missing or not dead-lettered" }
          }
        }
      },
      "/webhooks/preview": {
        post: {
          summary: "Preview a signed webhook payload",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true
                }
              }
            }
          },
          responses: {
            "200": { description: "Signature and payload returned" }
          }
        }
      }
    }
  }));

  return app;
}

function createWebhookDestinationPolicy(
  allowedHosts: string[],
  options: { dnsLookup?: WebhookDnsLookup } = {}
): WebhookDestinationPolicy {
  return {
    allowedHosts: allowedHosts
      .map(normalizeAllowedWebhookHost)
      .filter((host): host is string => !!host),
    dnsLookup: options.dnsLookup
  };
}

function guardedWebhookSender(
  policy: WebhookDestinationPolicy,
  sender: OutgoingWebhookSender
): OutgoingWebhookSender {
  return async (request) => {
    try {
      const url = assertWebhookUrlAllowed(request.url, policy);
      await assertWebhookDnsAllowed(url, policy);
    } catch (error) {
      if (error instanceof WebhookDestinationPolicyError) {
        return {
          statusCode: 400,
          body: {
            error: "webhook_destination_blocked",
            message: error.message
          }
        };
      }

      throw error;
    }

    return sender(request);
  };
}

async function lookupWebhookHostname(hostname: string): Promise<WebhookDnsAddress[]> {
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true
  });

  return addresses.map((address) => ({
    address: address.address,
    family: address.family === 6 ? 6 : 4
  }));
}

async function sendOutgoingWebhook(
  request: OutgoingWebhookRequest
): Promise<OutgoingWebhookSenderResult> {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.payload),
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.text().catch(() => undefined);
  return {
    statusCode: response.status,
    body
  };
}

function assertWebhookDestinationFromCampaignInput(
  input: unknown,
  policy: WebhookDestinationPolicy
): void {
  const webhookUrl = webhookUrlFromCampaignInput(input);
  if (webhookUrl) {
    assertWebhookUrlAllowed(webhookUrl, policy);
  }
}

function webhookUrlFromCampaignInput(input: unknown): string | undefined {
  if (!isRecord(input) || !isRecord(input.settings)) {
    return undefined;
  }

  return typeof input.settings.webhookUrl === "string" ? input.settings.webhookUrl : undefined;
}

class WebhookDestinationPolicyError extends Error {}

function assertWebhookUrlAllowed(rawUrl: string, policy: WebhookDestinationPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookDestinationPolicyError("Webhook URL must be a valid absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new WebhookDestinationPolicyError("Webhook URL must use https");
  }

  const hostname = normalizeWebhookHostname(url.hostname);
  if (isBlockedWebhookHostname(hostname)) {
    throw new WebhookDestinationPolicyError(`Webhook URL host ${hostname} is not allowed`);
  }

  if (
    policy.allowedHosts.length > 0 &&
    !isAllowedWebhookHostname(hostname, policy.allowedHosts)
  ) {
    throw new WebhookDestinationPolicyError(
      `Webhook URL host ${hostname} is not in INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS`
    );
  }

  return url;
}

async function assertWebhookDnsAllowed(
  url: URL,
  policy: WebhookDestinationPolicy
): Promise<void> {
  if (!policy.dnsLookup) {
    return;
  }

  const hostname = normalizeWebhookHostname(url.hostname);
  if (isIP(hostname) !== 0) {
    return;
  }

  const addresses = await policy.dnsLookup(hostname);
  const blocked = addresses.find((address) =>
    isBlockedWebhookIpAddress(normalizeWebhookHostname(address.address))
  );
  if (blocked) {
    throw new WebhookDestinationPolicyError(
      `Webhook URL host ${hostname} resolved to blocked address ${blocked.address}`
    );
  }
}

function normalizeAllowedWebhookHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("*.")) {
    const suffix = normalizeWebhookHostname(trimmed.slice(2));
    return suffix ? `*.${suffix}` : null;
  }

  try {
    return normalizeWebhookHostname(new URL(trimmed).hostname);
  } catch {
    try {
      return normalizeWebhookHostname(new URL(`https://${trimmed}`).hostname);
    } catch {
      return normalizeWebhookHostname(trimmed.split("/", 1)[0] ?? trimmed);
    }
  }
}

function normalizeWebhookHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/g, "");
}

function isAllowedWebhookHostname(hostname: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((allowedHost) => {
    if (allowedHost.startsWith("*.")) {
      const suffix = allowedHost.slice(1);
      return hostname.endsWith(suffix) && hostname !== allowedHost.slice(2);
    }

    return hostname === allowedHost;
  });
}

function isBlockedWebhookHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }

  return isBlockedWebhookIpAddress(hostname);
}

function isBlockedWebhookIpAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return isBlockedIpv4Hostname(address);
  }
  if (ipVersion === 6) {
    return isBlockedIpv6Hostname(address);
  }

  return false;
}

function isBlockedIpv4Hostname(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isBlockedIpv6Hostname(hostname: string): boolean {
  return (
    hostname === "::" ||
    hostname === "::1" ||
    hostname.startsWith("::ffff:") ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("ff")
  );
}

function targetWithNewEvent(
  previous: Campaign,
  updated: Campaign,
  target: string
): CampaignTarget | null {
  const handle = normalizeInstagramHandle(target);
  const previousTarget = previous.targets.find((candidate) => candidate.handle === handle);
  const updatedTarget = updated.targets.find((candidate) => candidate.handle === handle);
  if (!updatedTarget) {
    return null;
  }

  const previousEventIds = new Set(
    previousTarget?.events.map((event) => event.eventId) ?? []
  );
  return updatedTarget.events.some((event) => !previousEventIds.has(event.eventId))
    ? updatedTarget
    : null;
}

async function dispatchTargetWebhook(
  dispatcher: OutgoingWebhookDispatcher,
  campaign: Campaign,
  target: CampaignTarget
): Promise<WebhookDeliveryRecord | null> {
  const job = createTargetWebhookJob(campaign, target);
  return job ? dispatcher.dispatch(job) : null;
}

function normalizeOptionalApiKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isPublicRequest(method: string, url: string): boolean {
  if (method.toUpperCase() === "OPTIONS") {
    return true;
  }

  const path = url.split("?", 1)[0];
  return method.toUpperCase() === "GET" && (path === "/health" || path === "/openapi.json");
}

function extractApiKeyCandidates(
  headers: Record<string, string | string[] | undefined>
): string[] {
  const candidates: string[] = [];
  const apiKeyHeader = firstHeaderValue(headers["x-api-key"]);
  if (apiKeyHeader) {
    candidates.push(apiKeyHeader);
  }

  const authorization = firstHeaderValue(headers.authorization);
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    candidates.push(bearer);
  }

  return candidates;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

function apiKeysEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function openApiPathParameters(...names: string[]) {
  return names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" }
  }));
}

function openApiIdempotencyHeader() {
  return {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    schema: { type: "string" },
    description: "Optional retry-safe idempotency key for create or manual evidence requests."
  };
}

function openApiManualQueueQueryParameters() {
  return [
    {
      name: "campaignId",
      in: "query",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "executionId",
      in: "query",
      required: false,
      schema: { type: "string" }
    },
    {
      name: "status",
      in: "query",
      required: false,
      schema: {
        type: "string",
        enum: ["pending", "pending_initial_evidence", "reply_monitoring", "done", "all"],
        default: "pending"
      }
    },
    {
      name: "includeHistorical",
      in: "query",
      required: false,
      schema: { type: "boolean", default: false }
    },
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 500, default: 100 }
    }
  ];
}

function openApiSenderAccountSchema() {
  return {
    type: "object",
    required: ["id", "dailyLimit"],
    properties: {
      id: { type: "string" },
      status: {
        type: "string",
        enum: ["healthy", "cooldown", "locked", "reconnect_required"],
        default: "healthy"
      },
      dailyLimit: { type: "integer", minimum: 1, maximum: 200 },
      cooldownUntil: { type: "string", format: "date-time" },
      warmupNote: { type: "string" },
      riskEvents: {
        type: "array",
        items: {
          type: "object",
          required: ["kind", "at", "note"],
          properties: {
            kind: {
              type: "string",
              enum: ["warning", "restriction", "lockout", "reconnect_required", "manual_note"]
            },
            at: { type: "string", format: "date-time" },
            note: { type: "string" }
          }
        }
      }
    }
  };
}

function openApiSenderAccountRequestSchema() {
  return {
    type: "object",
    required: ["dailyLimit"],
    properties: {
      status: {
        type: "string",
        enum: ["healthy", "cooldown", "locked", "reconnect_required"],
        default: "healthy"
      },
      dailyLimit: { type: "integer", minimum: 1, maximum: 200 },
      cooldownUntil: { type: "string", format: "date-time" },
      warmupNote: { type: "string" },
      riskEvents: openApiSenderAccountSchema().properties.riskEvents
    }
  };
}

function openApiSenderRiskEventRequestSchema() {
  return {
    type: "object",
    required: ["kind", "note"],
    properties: {
      kind: {
        type: "string",
        enum: ["warning", "restriction", "lockout", "reconnect_required", "manual_note"]
      },
      at: { type: "string", format: "date-time" },
      note: { type: "string" },
      status: {
        type: "string",
        enum: ["healthy", "cooldown", "locked", "reconnect_required"]
      },
      cooldownUntil: { type: "string", format: "date-time" },
      warmupNote: { type: "string" }
    }
  };
}

function openApiManualEvidenceSchema() {
  return {
    oneOf: [
      openApiManualEvidenceCase("sent", ["messageId"], ["operatorId", "conversationUrl", "screenshotUrl"]),
      openApiManualEvidenceCase("failed", ["reason"], ["operatorId"]),
      openApiManualEvidenceCase(
        "restricted",
        ["reason"],
        ["operatorId", "screenshotUrl", "restrictionSource"]
      ),
      openApiManualEvidenceCase(
        "replied",
        ["messageId", "replyText"],
        ["operatorId", "conversationUrl", "screenshotUrl", "replyCapturedAt"]
      )
    ]
  };
}

function openApiManualEvidenceCase(
  type: DeliveryEventType,
  requiredFields: string[],
  requiredEvidenceFields: string[]
) {
  return {
    type: "object",
    required: ["type", "evidence", ...requiredFields],
    anyOf: [{ required: ["intentId"] }, { required: ["target"] }],
    properties: {
      eventId: { type: "string" },
      intentId: { type: "string" },
      target: { type: "string" },
      type: { const: type },
      occurredAt: { type: "string", format: "date-time" },
      messageId: { type: "string" },
      reason: { type: "string" },
      replyText: { type: "string" },
      evidence: {
        type: "object",
        required: requiredEvidenceFields,
        additionalProperties: { type: "string" },
        properties: Object.fromEntries(
          requiredEvidenceFields.map((field) => [field, { type: "string" }])
        )
      },
      replyAssessment: {
        type: "object",
        properties: {
          disposition: {
            type: "string",
            enum: ["interested", "neutral", "not_interested", "opt_out", "complaint"]
          },
          qualified: { type: "boolean" },
          replyText: { type: "string" },
          note: { type: "string" }
        }
      },
      simulatedWebhookStatusCode: {
        type: "integer",
        minimum: 100,
        maximum: 599,
        description: "Simulated webhook status code used by local/manual pilot proof flows."
      }
    }
  };
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
      }),
      z.object({
        kind: z.literal("managed_provider"),
        id: z.string().min(1).max(120).default("managed_provider_delivery"),
        accountRiskOwner: z.enum(["operator", "provider"]).default("provider"),
        requiresHumanEvidence: z.boolean().default(false),
        notes: z.array(z.string().min(1).max(1000)).default([]),
        outcomes: z
          .array(
            z.object({
              target: z.string().min(1),
              outcome: z.enum(["accepted", "rejected"]),
              events: z
                .array(
                  z.object({
                    type: z.enum(["sent", "failed", "restricted", "replied"]),
                    occurredAt: z.string().datetime().optional(),
                    messageId: z.string().min(1).optional(),
                    reason: z.string().min(1).optional(),
                    replyText: z.string().min(1).optional(),
                    evidence: z.record(z.string(), z.string()).default({})
                  })
                )
                .min(1)
            })
          )
          .min(1)
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

const senderAccountRequestSchema = z.object({
  status: z.enum(["healthy", "cooldown", "locked", "reconnect_required"]).optional(),
  dailyLimit: z.number().int().min(1).max(200),
  cooldownUntil: z.string().datetime().optional(),
  warmupNote: z.string().min(1).max(1000).optional(),
  riskEvents: z
    .array(
      z.object({
        kind: z.enum(["warning", "restriction", "lockout", "reconnect_required", "manual_note"]),
        at: z.string().datetime(),
        note: z.string().min(1).max(1000)
      })
    )
    .optional()
});

const senderRiskEventRequestSchema = z.object({
  kind: z.enum(["warning", "restriction", "lockout", "reconnect_required", "manual_note"]),
  at: z.string().datetime().optional(),
  note: z.string().min(1).max(1000),
  status: z.enum(["healthy", "cooldown", "locked", "reconnect_required"]).optional(),
  cooldownUntil: z.string().datetime().optional(),
  warmupNote: z.string().min(1).max(1000).optional()
});

const approvalWorkbenchRequestSchema = z.object({
  approvedTargets: z.array(z.string().min(1)).default([]),
  rejectedTargets: z.array(z.string().min(1)).default([]),
  message: z.string().min(1).max(1000).optional(),
  approveMessage: z.boolean().default(true),
  actor: z.string().min(1).max(120).default("api")
});

type ApprovalWorkbenchRequest = z.infer<typeof approvalWorkbenchRequestSchema>;

const approvalDecisionRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  actor: z.string().min(1).max(120).default("api"),
  reason: z.string().min(1).max(1000).optional()
});

const operatorEvidenceRequestSchema = z.object({
  source: z.string().min(1).max(120).optional(),
  reference: z.string().min(1).max(500).optional(),
  note: z.string().min(1).max(1000).optional()
});

const operatorClaimRequestSchema = z.object({
  operator: z.string().min(1).max(120)
});

const operatorTerminalRequestSchema = z.object({
  work: z.enum(["skipped", "blocked"]),
  operator: z.string().min(1).max(120),
  reason: z.string().min(1).max(1000),
  evidence: operatorEvidenceRequestSchema.default({})
});

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

const manualQueueQuerySchema = z.object({
  campaignId: z.preprocess(queryValue, z.string().min(1).optional()),
  executionId: z.preprocess(queryValue, z.string().min(1).optional()),
  status: z.preprocess(
    queryValue,
    z
      .enum(["pending", "pending_initial_evidence", "reply_monitoring", "done", "all"])
      .default("pending")
  ),
  includeHistorical: z.preprocess(queryBooleanValue, z.boolean().default(false)),
  limit: z.preprocess(queryNumberValue(100), z.number().int().min(1).max(500).default(100))
});

type ManualQueueQuery = z.infer<typeof manualQueueQuerySchema>;

class NotFoundError extends Error {}
class ConflictError extends Error {}

type ManualQueueStatus = "pending_initial_evidence" | "reply_monitoring" | "done";

async function buildLatestProofPackReport(
  store: CampaignStore,
  campaign: Campaign
) {
  const executions = await store.listExecutions(campaign.id);
  const latestExecution = [...executions].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )[0];
  if (!latestExecution) {
    return null;
  }

  const campaignForReadiness = await withCurrentSenderInventorySnapshot(store, campaign);
  const readiness = buildPilotReadinessReport({
    campaign: campaignForReadiness,
    approvalWorkbench: await store.getApprovalWorkbench(campaign.id),
    executions
  });

  return {
    campaignId: campaign.id,
    campaignName: campaign.campaign,
    campaignStatus: campaignForReadiness.status,
    status: campaignForReadiness.status,
    summary: campaignForReadiness.summary,
    senderHealth: campaignForReadiness.senderHealth,
    readiness,
    latestExecution: {
      id: latestExecution.id,
      createdAt: latestExecution.createdAt,
      adapterRiskPosture: latestExecution.adapterRiskPosture,
      intentCount: latestExecution.intents.length,
      deliveryAttemptCount: latestExecution.deliveryAttempts.length,
      webhookDeliveryCount: latestExecution.webhookDeliveries.length
    },
    proofPack: latestExecution.proofPack,
    metrics: latestExecution.proofPack.metrics,
    renewalRecommendation: latestExecution.proofPack.renewalRecommendation,
    markdown: latestExecution.proofPack.markdown,
    nextActions: readiness.nextActions,
    externalInputs: readiness.externalInputs,
    source: {
      readinessUrl: `/campaigns/${campaign.id}/readiness`,
      executionUrl: `/campaigns/${campaign.id}/executions/${latestExecution.id}`,
      executionsUrl: `/campaigns/${campaign.id}/executions`
    }
  };
}

async function buildOperatorManualQueue(
  store: CampaignStore,
  query: ManualQueueQuery,
  now = new Date()
) {
  const campaigns = query.campaignId
    ? await campaignsForManualQueue(store, query.campaignId)
    : await store.list();
  const items: Array<ReturnType<typeof manualQueueItem>> = [];

  for (const campaign of campaigns) {
    const executions = selectManualExecutionsForQueue(
      await store.listExecutions(campaign.id),
      query
    );

    for (const execution of executions) {
      items.push(...manualQueueItemsForExecution(campaign, execution));
    }
  }

  const filteredItems = filterManualQueueItems(items, query.status).slice(0, query.limit);

  return {
    generatedAt: now.toISOString(),
    filters: {
      campaignId: query.campaignId,
      executionId: query.executionId,
      status: query.status,
      includeHistorical: query.includeHistorical,
      limit: query.limit
    },
    counts: countManualQueueItems(items),
    items: filteredItems
  };
}

async function campaignsForManualQueue(
  store: CampaignStore,
  campaignId: string
): Promise<Campaign[]> {
  const campaign = await store.get(campaignId);
  return campaign ? [campaign] : [];
}

function buildManualDeliveryQueue(execution: CampaignExecutionRecord, campaign?: Campaign) {
  const items = manualQueueItemsForExecution(campaign, execution);
  return {
    campaignId: execution.campaignId,
    campaignName: campaign?.campaign,
    executionId: execution.id,
    executionCreatedAt: execution.createdAt,
    adapterRiskPosture: execution.adapterRiskPosture,
    counts: countManualQueueItems(items),
    proofPackSummary: {
      contactedTargets: execution.proofPack.metrics.contactedTargets,
      sentMessages: execution.proofPack.metrics.sentMessages,
      replies: execution.proofPack.metrics.replies,
      deliveryFailures: execution.proofPack.metrics.deliveryFailures,
      webhookDelivered: execution.proofPack.metrics.webhookDelivered,
      webhookDeadLetters: execution.proofPack.metrics.webhookDeadLetters,
      renewalDecision: execution.proofPack.renewalRecommendation.decision
    },
    items
  };
}

function selectManualExecutionsForQueue(
  executions: CampaignExecutionRecord[],
  query: ManualQueueQuery
): CampaignExecutionRecord[] {
  const manualExecutions = executions
    .filter((execution) => execution.deliveryAttempts.some((attempt) => attempt.riskPosture.kind === "manual"))
    .filter((execution) => !query.executionId || execution.id === query.executionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (query.executionId || query.includeHistorical) {
    return manualExecutions;
  }

  return manualExecutions.slice(0, 1);
}

function manualQueueItemsForExecution(
  campaign: Campaign | undefined,
  execution: CampaignExecutionRecord
) {
  return execution.deliveryAttempts
    .filter((attempt) => attempt.riskPosture.kind === "manual")
    .map((attempt) => manualQueueItem(campaign, execution, attempt));
}

function manualQueueItem(
  campaign: Campaign | undefined,
  execution: CampaignExecutionRecord,
  attempt: DeliveryAttempt
) {
  const status = manualQueueStatus(attempt);
  const allowedManualEvents = allowedManualEventsForStatus(status);
  const events = attempt.events.map((event) => ({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    messageId: event.messageId,
    reason: event.reason,
    replyText: event.replyText,
    evidence: event.evidence
  }));

  return {
    queueId: `${execution.campaignId}:${execution.id}:${attempt.intent.id}`,
    campaignId: execution.campaignId,
    campaignName: campaign?.campaign,
    executionId: execution.id,
    executionCreatedAt: execution.createdAt,
    intentId: attempt.intent.id,
    target: attempt.intent.target,
    targetHandle: attempt.intent.targetHandle,
    senderAccountId: attempt.intent.senderAccountId,
    message: attempt.intent.message,
    scheduledAt: attempt.intent.scheduledAt,
    approvedAt: attempt.intent.approvedAt,
    status,
    outcome: attempt.outcome,
    allowedManualEvents,
    requiredEvidenceByEvent: Object.fromEntries(
      allowedManualEvents.map((type) => [
        type,
        requiredEvidenceForType(attempt.requiredEvidence, type).map((field) => field.key)
      ])
    ),
    requiredEvidenceDetailsByEvent: Object.fromEntries(
      allowedManualEvents.map((type) => [
        type,
        requiredEvidenceForType(attempt.requiredEvidence, type)
      ])
    ),
    latestEvent: events.at(-1) ?? null,
    manualEvents: events,
    manualEventsUrl: `/campaigns/${execution.campaignId}/executions/${execution.id}/manual-events`
  };
}

function manualQueueStatus(attempt: DeliveryAttempt): ManualQueueStatus {
  const eventTypes = new Set(attempt.events.map((event) => event.type));
  if (eventTypes.has("replied") || eventTypes.has("restricted") || eventTypes.has("failed")) {
    return "done";
  }
  if (eventTypes.has("sent")) {
    return "reply_monitoring";
  }
  return "pending_initial_evidence";
}

function allowedManualEventsForStatus(status: ManualQueueStatus): DeliveryEventType[] {
  if (status === "pending_initial_evidence") {
    return ["sent", "failed", "restricted"];
  }
  if (status === "reply_monitoring") {
    return ["replied"];
  }
  return [];
}

function filterManualQueueItems(
  items: ReturnType<typeof manualQueueItem>[],
  status: ManualQueueQuery["status"]
) {
  if (status === "all") {
    return items;
  }
  if (status === "pending") {
    return items.filter((item) => item.status === "pending_initial_evidence");
  }
  return items.filter((item) => item.status === status);
}

function countManualQueueItems(items: ReturnType<typeof manualQueueItem>[]) {
  return {
    total: items.length,
    pendingInitialEvidence: items.filter((item) => item.status === "pending_initial_evidence").length,
    replyMonitoring: items.filter((item) => item.status === "reply_monitoring").length,
    done: items.filter((item) => item.status === "done").length
  };
}

function requiredEvidenceForType(
  requirements: ManualEvidenceRequirement[],
  type: DeliveryEventType
) {
  return requirements
    .filter((requirement) => requirement.requiredFor.includes(type))
    .map((requirement) => ({
      key: requirement.key,
      label: requirement.label,
      description: requirement.description
    }));
}

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

function buildStoredApprovalWorkbench(
  campaign: Campaign,
  request: ApprovalWorkbenchRequest
): ApprovalWorkbench {
  const candidateTargets = scheduledTargetHandles(campaign);
  if (candidateTargets.length === 0) {
    throw new Error("Campaign has no scheduled targets to approve");
  }

  let workbench = createApprovalWorkbench({
    campaignId: campaign.id,
    candidates: candidateTargets.map((target, index) => ({
      id: `candidate_${index + 1}`,
      target
    })),
    messages: [
      {
        id: "copy_1",
        body: request.message ?? campaign.message
      }
    ]
  });
  const approved = new Set(request.approvedTargets.map(normalizeHandle));
  const rejected = new Set(request.rejectedTargets.map(normalizeHandle));

  for (const candidate of workbench.candidates) {
    if (rejected.has(candidate.handle)) {
      workbench = rejectCandidate(workbench, {
        candidateId: candidate.id,
        actor: request.actor,
        reason: "Rejected through approval API"
      });
      continue;
    }

    if (approved.has(candidate.handle)) {
      workbench = approveCandidate(workbench, {
        candidateId: candidate.id,
        actor: request.actor,
        reason: "Approved through approval API"
      });
    }
  }

  if (request.approveMessage) {
    workbench = approveMessage(workbench, {
      messageId: "copy_1",
      actor: request.actor,
      reason: "Approved through approval API"
    });
  }

  return workbench;
}

function buildExecutionApprovalWorkbench(
  campaign: Campaign,
  request: ExecutionRequest,
  storedWorkbench: ApprovalWorkbench | null
): ApprovalWorkbench {
  if (storedWorkbench && !hasInlineApprovalOverrides(request)) {
    return storedWorkbench;
  }

  const candidateTargets = uniqueTargets(scheduledTargetHandles(campaign));
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
  const approved = new Set((request.approvals.approvedTargets ?? []).map(normalizeHandle));
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

function hasInlineApprovalOverrides(request: ExecutionRequest): boolean {
  return (
    request.approvals.approvedTargets !== undefined ||
    request.approvals.rejectedTargets.length > 0 ||
    request.approvals.message !== undefined
  );
}

function assertExecutionReadiness(
  campaign: Campaign,
  workbench: ApprovalWorkbench | null,
  executions: CampaignExecutionRecord[]
): void {
  const readiness = buildPilotReadinessReport({
    campaign,
    approvalWorkbench: workbench,
    executions
  });
  if (readiness.readyForExecution) {
    return;
  }

  const failingGates = readiness.gates
    .filter((gate) => gate.status === "fail")
    .map((gate) => gate.label);
  const nextAction = readiness.nextActions[0];
  throw new ConflictError(
    [
      `Campaign is not ready for execution (${readiness.status}): ${failingGates.join(", ")}`,
      nextAction ? `Next action: ${nextAction}` : undefined
    ]
      .filter(Boolean)
      .join(". ")
  );
}

function validateManagedProviderOutcomes(
  campaign: Campaign,
  workbench: ApprovalWorkbench,
  request: ExecutionRequest
): void {
  if (request.adapter.kind !== "managed_provider") {
    return;
  }

  const expectedTargets = campaign.targets
    .filter(
      (target) =>
        target.status === "scheduled" &&
        target.handle &&
        isApprovedExecutionTarget(workbench, target.handle)
    )
    .map((target) => target.handle as string);
  const expected = new Set(expectedTargets);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const provided = new Set<string>();

  for (const outcome of request.adapter.outcomes) {
    const handle = normalizeHandle(outcome.target);
    if (seen.has(handle)) {
      duplicates.add(handle);
    }
    seen.add(handle);
    provided.add(handle);
  }

  if (duplicates.size > 0) {
    throw new Error(`Duplicate managed provider outcome target(s): ${[...duplicates].join(", ")}`);
  }

  const unknown = [...provided].filter((handle) => !expected.has(handle));
  if (unknown.length > 0) {
    throw new Error(`Unknown managed provider outcome target(s): ${unknown.join(", ")}`);
  }

  const missing = expectedTargets.filter((handle) => !provided.has(handle));
  if (missing.length > 0) {
    throw new Error(`Missing managed provider outcome target(s): ${missing.join(", ")}`);
  }
}

function buildDeliveryAdapter(request: ExecutionRequest) {
  if (request.adapter.kind === "manual") {
    return createManualDeliveryAdapter();
  }

  if (request.adapter.kind === "managed_provider") {
    const outcomesByTarget = new Map(
      request.adapter.outcomes.map((outcome) => [normalizeHandle(outcome.target), outcome])
    );

    return createManagedProviderDeliveryAdapter({
      id: request.adapter.id,
      accountRiskOwner: request.adapter.accountRiskOwner,
      requiresHumanEvidence: request.adapter.requiresHumanEvidence,
      notes:
        request.adapter.notes.length > 0
          ? request.adapter.notes
          : [
              "Managed provider execution uses operator-supplied provider outcomes.",
              "This API contract does not claim official cold-DM compliance or live Instagram delivery."
            ],
      deliver(intent) {
        const outcome = outcomesByTarget.get(intent.targetHandle);
        if (!outcome) {
          return {
            outcome: "rejected",
            events: [
              {
                type: "failed",
                reason: "No managed provider outcome supplied for target",
                evidence: { targetHandle: intent.targetHandle }
              }
            ]
          };
        }

        return {
          outcome: outcome.outcome,
          events: outcome.events
        };
      }
    });
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

async function withCurrentSenderInventorySnapshot(
  store: CampaignStore,
  campaign: Campaign
): Promise<Campaign> {
  const senderAccounts = await currentSenderAccountsForCampaign(store, campaign);
  if (!senderAccounts) {
    return campaign;
  }

  return {
    ...campaign,
    settings: {
      ...campaign.settings,
      senderPool: senderAccounts.map((account) => account.id),
      senderAccounts
    },
    senderHealth: summarizeSenderInventory(senderAccounts)
  };
}

async function currentSenderAccountsForCampaign(
  store: CampaignStore,
  campaign: Campaign
): Promise<SenderAccount[] | null> {
  if (campaign.metadata.senderInventorySource !== "managed_store") {
    return null;
  }

  const storedAccounts = await store.listSenderAccounts();
  if (storedAccounts.length === 0) {
    return null;
  }

  const byId = new Map(storedAccounts.map((account) => [account.id, account]));
  const senderIds = [...new Set(campaign.settings.senderPool)].filter((id) => byId.has(id));
  if (senderIds.length === 0) {
    return null;
  }

  return senderIds.map((id) => byId.get(id) as SenderAccount);
}

function assertCurrentSenderAvailability(
  campaign: Campaign,
  workbench: ApprovalWorkbench
): void {
  const healthById = new Map(
    campaign.senderHealth.accounts.map((account) => [account.id, account])
  );
  const unavailable = new Set<string>();

  for (const target of campaign.targets) {
    if (
      target.status !== "scheduled" ||
      !target.handle ||
      !target.sender ||
      !isApprovedExecutionTarget(workbench, target.handle)
    ) {
      continue;
    }

    const health = healthById.get(target.sender);
    if (health && !health.available) {
      unavailable.add(target.sender);
    }
  }

  if (unavailable.size > 0) {
    throw new ConflictError(
      `Sender account(s) unavailable for execution: ${[...unavailable].join(", ")}`
    );
  }
}

function isApprovedExecutionTarget(workbench: ApprovalWorkbench, target: string): boolean {
  const handle = normalizeHandle(target);
  return workbench.candidates.some(
    (candidate) =>
      candidate.handle === handle &&
      candidate.approval === "approved" &&
      (candidate.work === "queued" || candidate.work === "claimed")
  );
}

async function withStoredSenderInventory(
  store: CampaignStore,
  body: unknown
): Promise<unknown> {
  if (!isRecord(body)) {
    return body;
  }

  const settings = isRecord(body.settings) ? body.settings : {};
  if (Array.isArray(settings.senderAccounts) && settings.senderAccounts.length > 0) {
    return body;
  }

  const storedAccounts = await store.listSenderAccounts();
  if (storedAccounts.length === 0) {
    return body;
  }

  let requestedSenderPool: string[] | undefined;
  if (settings.senderPool !== undefined) {
    if (
      !Array.isArray(settings.senderPool) ||
      settings.senderPool.length === 0 ||
      settings.senderPool.some((entry) => typeof entry !== "string")
    ) {
      return body;
    }

    requestedSenderPool = settings.senderPool;
  }

  if (requestedSenderPool) {
    const storedIds = new Set(storedAccounts.map((account) => account.id));
    const missing = requestedSenderPool.filter((id) => !storedIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Unknown managed sender account(s): ${missing.join(", ")}`);
    }
  }

  const selectedAccounts = selectStoredSenderAccounts(storedAccounts, requestedSenderPool);
  if (selectedAccounts.length === 0) {
    return body;
  }

  return {
    ...body,
    metadata:
      body.metadata === undefined || isRecord(body.metadata)
        ? {
            ...(isRecord(body.metadata) ? body.metadata : {}),
            senderInventorySource: "managed_store"
          }
        : body.metadata,
    settings: {
      ...settings,
      senderPool: selectedAccounts.map((account) => account.id),
      senderAccounts: selectedAccounts
    }
  };
}

function selectStoredSenderAccounts(
  accounts: SenderAccount[],
  senderPool: string[] | undefined
): SenderAccount[] {
  if (!senderPool || senderPool.length === 0) {
    return accounts;
  }

  const requested = new Set(senderPool);
  return accounts.filter((account) => requested.has(account.id));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function queryBooleanValue(value: unknown): unknown {
  const normalized = queryValue(value);
  if (normalized === undefined) {
    return false;
  }
  if (normalized === "true" || normalized === true) {
    return true;
  }
  if (normalized === "false" || normalized === false) {
    return false;
  }
  return normalized;
}

function queryNumberValue(defaultValue: number) {
  return (value: unknown): unknown => {
    const normalized = queryValue(value);
    return normalized === undefined ? defaultValue : Number(normalized);
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
