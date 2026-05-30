import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { createCampaign, recordTargetEvent } from "./domain/campaign.js";
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
      const campaign = await store.insert(createCampaign(request.body));
      const response = {
        campaignId: campaign.id,
        status: campaign.status,
        summary: campaign.summary,
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
        summary: updated.summary
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
