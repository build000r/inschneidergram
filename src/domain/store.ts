import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

export interface CampaignStore {
  insert(campaign: Campaign): Promise<Campaign>;
  get(id: string): Promise<Campaign | null>;
  update(campaign: Campaign): Promise<Campaign>;
  list(): Promise<Campaign[]>;
  listSuppressions(): Promise<SuppressionRecord[]>;
  upsertApprovalWorkbench(workbench: ApprovalWorkbench): Promise<ApprovalWorkbench>;
  getApprovalWorkbench(campaignId: string): Promise<ApprovalWorkbench | null>;
  insertExecution(record: CampaignExecutionRecord): Promise<CampaignExecutionRecord>;
  getExecution(id: string): Promise<CampaignExecutionRecord | null>;
  listExecutions(campaignId: string): Promise<CampaignExecutionRecord[]>;
}

export class InMemoryCampaignStore implements CampaignStore {
  private campaigns = new Map<string, Campaign>();
  private idempotencyIndex = new Map<string, string>();
  private suppressions = new Map<string, SuppressionRecord>();
  private approvalWorkbenches = new Map<string, ApprovalWorkbench>();
  private executions = new Map<string, CampaignExecutionRecord>();

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
  approvalWorkbenches: ApprovalWorkbench[];
  executions: CampaignExecutionRecord[];
}

export class JsonFileCampaignStore implements CampaignStore {
  private queue = Promise.resolve();

  constructor(private readonly path: string) {}

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
        approvalWorkbenches: Array.isArray(parsed.approvalWorkbenches)
          ? parsed.approvalWorkbenches
          : [],
        executions: Array.isArray(parsed.executions) ? parsed.executions : []
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { campaigns: [], suppressions: [], approvalWorkbenches: [], executions: [] };
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
