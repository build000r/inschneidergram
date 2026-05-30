import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { summarizeCampaign, type Campaign } from "./campaign.js";

export interface SuppressionRecord {
  handle: string;
  campaignId: string;
  targetRaw: string;
  createdAt: string;
  reason: "campaign_target";
}

export interface CampaignStore {
  insert(campaign: Campaign): Promise<Campaign>;
  get(id: string): Promise<Campaign | null>;
  update(campaign: Campaign): Promise<Campaign>;
  list(): Promise<Campaign[]>;
  listSuppressions(): Promise<SuppressionRecord[]>;
}

export class InMemoryCampaignStore implements CampaignStore {
  private campaigns = new Map<string, Campaign>();
  private idempotencyIndex = new Map<string, string>();
  private suppressions = new Map<string, SuppressionRecord>();

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
        suppressions: Array.isArray(parsed.suppressions) ? parsed.suppressions : []
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { campaigns: [], suppressions: [] };
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
