import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApprovalWorkbench } from "./approval.js";
import { summarizeCampaign, type Campaign } from "./campaign.js";
import type {
  DeliveryAdapterRiskPosture,
  DeliveryAttempt,
  SendIntent
} from "./delivery.js";
import type { WebhookDeliveryRecord } from "./outgoingWebhook.js";
import type { PilotIncident, PilotProofPack, ReplyAssessment } from "./proofPack.js";
import {
  recordSenderRiskEvent,
  type SenderAccount,
  type SenderRiskEventInput
} from "./sender.js";

export interface SuppressionRecord {
  handle: string;
  campaignId: string;
  targetRaw: string;
  createdAt: string;
  reason: "campaign_target";
}

export interface CampaignExecutionRecordInput {
  campaignId: string;
  adapterRiskPosture: DeliveryAdapterRiskPosture | null;
  intents: SendIntent[];
  deliveryAttempts: DeliveryAttempt[];
  webhookDeliveries: WebhookDeliveryRecord[];
  approvalWorkbench?: ApprovalWorkbench;
  replyAssessments?: ReplyAssessment[];
  incidents?: PilotIncident[];
  proofPack: PilotProofPack;
}

export interface CampaignExecutionRecord extends CampaignExecutionRecordInput {
  id: string;
  createdAt: string;
}

export interface CampaignExecutionMutation<T> {
  campaign: Campaign;
  execution: CampaignExecutionRecord;
  result: T;
}

export interface CampaignStoreHealth {
  ok: boolean;
  kind: "memory" | "json_file";
  path?: string;
  message?: string;
}

export interface CampaignStore {
  healthCheck(): Promise<CampaignStoreHealth>;
  insert(campaign: Campaign): Promise<Campaign>;
  get(id: string): Promise<Campaign | null>;
  update(campaign: Campaign): Promise<Campaign>;
  list(): Promise<Campaign[]>;
  listSuppressions(): Promise<SuppressionRecord[]>;
  upsertSenderAccount(account: SenderAccount): Promise<SenderAccount>;
  getSenderAccount(id: string): Promise<SenderAccount | null>;
  listSenderAccounts(): Promise<SenderAccount[]>;
  appendSenderRiskEvent(
    id: string,
    input: SenderRiskEventInput,
    now?: Date
  ): Promise<SenderAccount | null>;
  upsertApprovalWorkbench(workbench: ApprovalWorkbench): Promise<ApprovalWorkbench>;
  getApprovalWorkbench(campaignId: string): Promise<ApprovalWorkbench | null>;
  insertExecution(record: CampaignExecutionRecord): Promise<CampaignExecutionRecord>;
  getExecution(id: string): Promise<CampaignExecutionRecord | null>;
  listExecutions(campaignId: string): Promise<CampaignExecutionRecord[]>;
  updateCampaignExecution<T>(
    campaignId: string,
    executionId: string,
    updater: (
      campaign: Campaign,
      execution: CampaignExecutionRecord
    ) => Promise<CampaignExecutionMutation<T>>
  ): Promise<T | null>;
}

export class InMemoryCampaignStore implements CampaignStore {
  private campaigns = new Map<string, Campaign>();
  private idempotencyIndex = new Map<string, string>();
  private suppressions = new Map<string, SuppressionRecord>();
  private senderAccounts = new Map<string, SenderAccount>();
  private approvalWorkbenches = new Map<string, ApprovalWorkbench>();
  private executions = new Map<string, CampaignExecutionRecord>();

  async healthCheck(): Promise<CampaignStoreHealth> {
    return { ok: true, kind: "memory" };
  }

  async insert(campaign: Campaign): Promise<Campaign> {
    const existing = this.findByIdempotencyKey(campaign.idempotencyKey);
    if (existing) {
      return existing;
    }

    const stored = applySuppressionRecords(campaign, [...this.suppressions.values()]);
    this.campaigns.set(stored.id, structuredClone(stored));
    if (campaign.idempotencyKey) {
      this.idempotencyIndex.set(campaign.idempotencyKey, stored.id);
    }
    this.mergeSuppressions(suppressionRecordsForCampaign(stored));
    return structuredClone(stored);
  }

  async get(id: string): Promise<Campaign | null> {
    const campaign = this.campaigns.get(id);
    return campaign ? structuredClone(campaign) : null;
  }

  async update(campaign: Campaign): Promise<Campaign> {
    this.campaigns.set(campaign.id, structuredClone(campaign));
    if (campaign.idempotencyKey) {
      this.idempotencyIndex.set(campaign.idempotencyKey, campaign.id);
    }
    this.mergeSuppressions(suppressionRecordsForCampaign(campaign));
    return structuredClone(campaign);
  }

  async list(): Promise<Campaign[]> {
    return [...this.campaigns.values()].map((campaign) => structuredClone(campaign));
  }

  async listSuppressions(): Promise<SuppressionRecord[]> {
    return [...this.suppressions.values()].map((record) => structuredClone(record));
  }

  async upsertSenderAccount(account: SenderAccount): Promise<SenderAccount> {
    this.senderAccounts.set(account.id, structuredClone(account));
    return structuredClone(account);
  }

  async getSenderAccount(id: string): Promise<SenderAccount | null> {
    const account = this.senderAccounts.get(id);
    return account ? structuredClone(account) : null;
  }

  async listSenderAccounts(): Promise<SenderAccount[]> {
    return [...this.senderAccounts.values()].map((account) => structuredClone(account));
  }

  async appendSenderRiskEvent(
    id: string,
    input: SenderRiskEventInput,
    now = new Date()
  ): Promise<SenderAccount | null> {
    const account = this.senderAccounts.get(id);
    if (!account) {
      return null;
    }

    const updated = recordSenderRiskEvent(account, input, now);
    this.senderAccounts.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  async upsertApprovalWorkbench(workbench: ApprovalWorkbench): Promise<ApprovalWorkbench> {
    this.approvalWorkbenches.set(workbench.campaignId, structuredClone(workbench));
    return structuredClone(workbench);
  }

  async getApprovalWorkbench(campaignId: string): Promise<ApprovalWorkbench | null> {
    const workbench = this.approvalWorkbenches.get(campaignId);
    return workbench ? structuredClone(workbench) : null;
  }

  async insertExecution(record: CampaignExecutionRecord): Promise<CampaignExecutionRecord> {
    this.executions.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async getExecution(id: string): Promise<CampaignExecutionRecord | null> {
    const record = this.executions.get(id);
    return record ? structuredClone(record) : null;
  }

  async listExecutions(campaignId: string): Promise<CampaignExecutionRecord[]> {
    return [...this.executions.values()]
      .filter((record) => record.campaignId === campaignId)
      .map((record) => structuredClone(record));
  }

  async updateCampaignExecution<T>(
    campaignId: string,
    executionId: string,
    updater: (
      campaign: Campaign,
      execution: CampaignExecutionRecord
    ) => Promise<CampaignExecutionMutation<T>>
  ): Promise<T | null> {
    const campaign = this.campaigns.get(campaignId);
    const execution = this.executions.get(executionId);
    if (!campaign || !execution || execution.campaignId !== campaignId) {
      return null;
    }

    const mutation = await updater(structuredClone(campaign), structuredClone(execution));
    this.campaigns.set(mutation.campaign.id, structuredClone(mutation.campaign));
    this.executions.set(mutation.execution.id, structuredClone(mutation.execution));
    this.mergeSuppressions(suppressionRecordsForCampaign(mutation.campaign));
    return structuredClone(mutation.result);
  }

  private findByIdempotencyKey(idempotencyKey: string | undefined): Campaign | null {
    if (!idempotencyKey) {
      return null;
    }

    const campaignId = this.idempotencyIndex.get(idempotencyKey);
    const campaign = campaignId ? this.campaigns.get(campaignId) : null;
    return campaign ? structuredClone(campaign) : null;
  }

  private mergeSuppressions(records: SuppressionRecord[]): void {
    for (const record of records) {
      if (!this.suppressions.has(record.handle)) {
        this.suppressions.set(record.handle, structuredClone(record));
      }
    }
  }
}

interface StoreSnapshot {
  campaigns: Campaign[];
  suppressions: SuppressionRecord[];
  senderAccounts: SenderAccount[];
  approvalWorkbenches: ApprovalWorkbench[];
  executions: CampaignExecutionRecord[];
}

export class JsonFileCampaignStore implements CampaignStore {
  private queue = Promise.resolve();

  constructor(private readonly path: string) {}

  async healthCheck(): Promise<CampaignStoreHealth> {
    try {
      await this.locked(async () => {
        await this.readSnapshot();
        await mkdir(dirname(this.path), { recursive: true });
        const tempPath = `${this.path}.${process.pid}.health.tmp`;
        await writeFile(tempPath, "", "utf8");
        await rm(tempPath, { force: true });
      });
      return { ok: true, kind: "json_file", path: this.path };
    } catch (error) {
      return {
        ok: false,
        kind: "json_file",
        path: this.path,
        message: error instanceof Error ? error.message : "Store health check failed"
      };
    }
  }

  async insert(campaign: Campaign): Promise<Campaign> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const existing = campaign.idempotencyKey
        ? snapshot.campaigns.find(
            (candidate) => candidate.idempotencyKey === campaign.idempotencyKey
          )
        : undefined;

      if (existing) {
        return structuredClone(existing);
      }

      const stored = applySuppressionRecords(campaign, snapshot.suppressions);
      snapshot.campaigns.push(structuredClone(stored));
      snapshot.suppressions = mergeSuppressionRecords(
        snapshot.suppressions,
        suppressionRecordsForCampaign(stored)
      );
      await this.writeSnapshot(snapshot);
      return structuredClone(stored);
    });
  }

  async get(id: string): Promise<Campaign | null> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const campaign = snapshot.campaigns.find((candidate) => candidate.id === id);
      return campaign ? structuredClone(campaign) : null;
    });
  }

  async update(campaign: Campaign): Promise<Campaign> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.campaigns.findIndex((candidate) => candidate.id === campaign.id);

      if (index === -1) {
        snapshot.campaigns.push(structuredClone(campaign));
      } else {
        snapshot.campaigns[index] = structuredClone(campaign);
      }

      snapshot.suppressions = mergeSuppressionRecords(
        snapshot.suppressions,
        suppressionRecordsForCampaign(campaign)
      );
      await this.writeSnapshot(snapshot);
      return structuredClone(campaign);
    });
  }

  async list(): Promise<Campaign[]> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      return snapshot.campaigns.map((campaign) => structuredClone(campaign));
    });
  }

  async listSuppressions(): Promise<SuppressionRecord[]> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      return snapshot.suppressions.map((record) => structuredClone(record));
    });
  }

  async upsertSenderAccount(account: SenderAccount): Promise<SenderAccount> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.senderAccounts.findIndex((candidate) => candidate.id === account.id);

      if (index === -1) {
        snapshot.senderAccounts.push(structuredClone(account));
      } else {
        snapshot.senderAccounts[index] = structuredClone(account);
      }

      await this.writeSnapshot(snapshot);
      return structuredClone(account);
    });
  }

  async getSenderAccount(id: string): Promise<SenderAccount | null> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const account = snapshot.senderAccounts.find((candidate) => candidate.id === id);
      return account ? structuredClone(account) : null;
    });
  }

  async listSenderAccounts(): Promise<SenderAccount[]> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      return snapshot.senderAccounts.map((account) => structuredClone(account));
    });
  }

  async appendSenderRiskEvent(
    id: string,
    input: SenderRiskEventInput,
    now = new Date()
  ): Promise<SenderAccount | null> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.senderAccounts.findIndex((candidate) => candidate.id === id);
      if (index === -1) {
        return null;
      }

      const updated = recordSenderRiskEvent(snapshot.senderAccounts[index], input, now);
      snapshot.senderAccounts[index] = structuredClone(updated);
      await this.writeSnapshot(snapshot);
      return structuredClone(updated);
    });
  }

  async upsertApprovalWorkbench(workbench: ApprovalWorkbench): Promise<ApprovalWorkbench> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.approvalWorkbenches.findIndex(
        (candidate) => candidate.campaignId === workbench.campaignId
      );

      if (index === -1) {
        snapshot.approvalWorkbenches.push(structuredClone(workbench));
      } else {
        snapshot.approvalWorkbenches[index] = structuredClone(workbench);
      }

      await this.writeSnapshot(snapshot);
      return structuredClone(workbench);
    });
  }

  async getApprovalWorkbench(campaignId: string): Promise<ApprovalWorkbench | null> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const workbench = snapshot.approvalWorkbenches.find(
        (candidate) => candidate.campaignId === campaignId
      );
      return workbench ? structuredClone(workbench) : null;
    });
  }

  async insertExecution(record: CampaignExecutionRecord): Promise<CampaignExecutionRecord> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.executions.findIndex((candidate) => candidate.id === record.id);

      if (index === -1) {
        snapshot.executions.push(structuredClone(record));
      } else {
        snapshot.executions[index] = structuredClone(record);
      }

      await this.writeSnapshot(snapshot);
      return structuredClone(record);
    });
  }

  async getExecution(id: string): Promise<CampaignExecutionRecord | null> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const record = snapshot.executions.find((candidate) => candidate.id === id);
      return record ? structuredClone(record) : null;
    });
  }

  async listExecutions(campaignId: string): Promise<CampaignExecutionRecord[]> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      return snapshot.executions
        .filter((record) => record.campaignId === campaignId)
        .map((record) => structuredClone(record));
    });
  }

  async updateCampaignExecution<T>(
    campaignId: string,
    executionId: string,
    updater: (
      campaign: Campaign,
      execution: CampaignExecutionRecord
    ) => Promise<CampaignExecutionMutation<T>>
  ): Promise<T | null> {
    return this.locked(async () => {
      const snapshot = await this.readSnapshot();
      const campaignIndex = snapshot.campaigns.findIndex((candidate) => candidate.id === campaignId);
      const executionIndex = snapshot.executions.findIndex(
        (candidate) => candidate.id === executionId && candidate.campaignId === campaignId
      );

      if (campaignIndex === -1 || executionIndex === -1) {
        return null;
      }

      const mutation = await updater(
        structuredClone(snapshot.campaigns[campaignIndex]),
        structuredClone(snapshot.executions[executionIndex])
      );
      snapshot.campaigns[campaignIndex] = structuredClone(mutation.campaign);
      snapshot.executions[executionIndex] = structuredClone(mutation.execution);
      snapshot.suppressions = mergeSuppressionRecords(
        snapshot.suppressions,
        suppressionRecordsForCampaign(mutation.campaign)
      );
      await this.writeSnapshot(snapshot);
      return structuredClone(mutation.result);
    });
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async readSnapshot(): Promise<StoreSnapshot> {
    try {
      const contents = await readFile(this.path, "utf8");
      const parsed = JSON.parse(contents) as StoreSnapshot;
      return {
        campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
        suppressions: Array.isArray(parsed.suppressions) ? parsed.suppressions : [],
        senderAccounts: Array.isArray(parsed.senderAccounts) ? parsed.senderAccounts : [],
        approvalWorkbenches: Array.isArray(parsed.approvalWorkbenches)
          ? parsed.approvalWorkbenches
          : [],
        executions: Array.isArray(parsed.executions) ? parsed.executions : []
      };
    } catch (error) {
      if (isNotFound(error)) {
        return {
          campaigns: [],
          suppressions: [],
          senderAccounts: [],
          approvalWorkbenches: [],
          executions: []
        };
      }
      throw error;
    }
  }

  private async writeSnapshot(snapshot: StoreSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, this.path);
  }
}

export function createCampaignExecutionRecord(
  input: CampaignExecutionRecordInput,
  now = new Date()
): CampaignExecutionRecord {
  return {
    id: `exec_${randomUUID()}`,
    createdAt: now.toISOString(),
    campaignId: input.campaignId,
    adapterRiskPosture: structuredClone(input.adapterRiskPosture),
    intents: structuredClone(input.intents),
    deliveryAttempts: structuredClone(input.deliveryAttempts),
    webhookDeliveries: structuredClone(input.webhookDeliveries),
    approvalWorkbench: input.approvalWorkbench
      ? structuredClone(input.approvalWorkbench)
      : undefined,
    replyAssessments: structuredClone(input.replyAssessments ?? []),
    incidents: structuredClone(input.incidents ?? []),
    proofPack: structuredClone(input.proofPack)
  };
}

function applySuppressionRecords(
  campaign: Campaign,
  suppressions: SuppressionRecord[]
): Campaign {
  const suppressedHandles = new Set(suppressions.map((record) => record.handle));
  const next = structuredClone(campaign);

  for (const target of next.targets) {
    if (!target.handle || target.status !== "scheduled") {
      continue;
    }

    if (suppressedHandles.has(target.handle)) {
      target.status = "skipped_duplicate";
      target.sender = null;
      target.scheduledAt = null;
    }
  }

  return summarizeCampaign(next);
}

function suppressionRecordsForCampaign(campaign: Campaign): SuppressionRecord[] {
  const records: SuppressionRecord[] = [];
  const seen = new Set<string>();

  for (const target of campaign.targets) {
    if (
      !target.handle ||
      target.status === "skipped_duplicate" ||
      target.status === "blocked_policy" ||
      seen.has(target.handle)
    ) {
      continue;
    }

    seen.add(target.handle);
    records.push({
      handle: target.handle,
      campaignId: campaign.id,
      targetRaw: target.raw,
      createdAt: campaign.createdAt,
      reason: "campaign_target"
    });
  }

  return records;
}

function mergeSuppressionRecords(
  existing: SuppressionRecord[],
  incoming: SuppressionRecord[]
): SuppressionRecord[] {
  const records = new Map<string, SuppressionRecord>();

  for (const record of existing) {
    records.set(record.handle, structuredClone(record));
  }

  for (const record of incoming) {
    if (!records.has(record.handle)) {
      records.set(record.handle, structuredClone(record));
    }
  }

  return [...records.values()];
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
