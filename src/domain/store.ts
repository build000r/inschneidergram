import type { Campaign } from "./campaign.js";

export interface CampaignStore {
  insert(campaign: Campaign): Promise<Campaign>;
  get(id: string): Promise<Campaign | null>;
  update(campaign: Campaign): Promise<Campaign>;
  list(): Promise<Campaign[]>;
}

export class InMemoryCampaignStore implements CampaignStore {
  private campaigns = new Map<string, Campaign>();

  async insert(campaign: Campaign): Promise<Campaign> {
    this.campaigns.set(campaign.id, structuredClone(campaign));
    return structuredClone(campaign);
  }

  async get(id: string): Promise<Campaign | null> {
    const campaign = this.campaigns.get(id);
    return campaign ? structuredClone(campaign) : null;
  }

  async update(campaign: Campaign): Promise<Campaign> {
    this.campaigns.set(campaign.id, structuredClone(campaign));
    return structuredClone(campaign);
  }

  async list(): Promise<Campaign[]> {
    return [...this.campaigns.values()].map((campaign) => structuredClone(campaign));
  }
}
