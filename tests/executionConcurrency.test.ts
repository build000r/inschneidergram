import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { InMemoryCampaignStore } from "../src/domain/store.js";
import type {
  CampaignExecutionRecord,
  CampaignLaunchCommit
} from "../src/domain/store.js";
import type { Campaign } from "../src/domain/campaign.js";
import type { SenderAccount } from "../src/domain/sender.js";

// Regression guard for the concurrent-execution double-send race.
//
// POST /campaigns/:id/executions used to read the campaign, derive sends, and
// then persist via separate store calls. Two executions that both read the
// campaign while a target was still "scheduled" each produced a send intent
// and persisted a separate execution -> the same creator was contacted twice.
//
// The fix persists the launch atomically through store.commitNewExecution,
// re-deriving sends against the campaign as freshly read inside the store's
// critical section. The second launch therefore sees the target already
// "sent" and contacts nobody.

/**
 * Forces the worst-case interleaving: the FIRST launch's commit is held until
 * the SECOND launch has entered commitNewExecution. If commitNewExecution is
 * NOT a real critical section the two reads see the same scheduled target and
 * both send (the original bug). With proper serialization the second launch is
 * blocked until the first commits, then reads the "sent" target and aborts.
 */
class BarrierExecutionStore extends InMemoryCampaignStore {
  private entries = 0;
  private secondEntered!: Promise<void>;
  private signalSecondEntered!: () => void;
  private firstHeld = false;

  constructor() {
    super();
    this.secondEntered = new Promise((resolve) => {
      this.signalSecondEntered = resolve;
    });
  }

  override async commitNewExecution<T>(
    campaignId: string,
    launch: (
      campaign: Campaign,
      executions: CampaignExecutionRecord[],
      allExecutions: CampaignExecutionRecord[],
      senderAccounts: SenderAccount[]
    ) => Promise<CampaignLaunchCommit<T> | null>
  ): Promise<T | null> {
    this.entries += 1;
    if (this.entries === 2) {
      this.signalSecondEntered();
    }
    return super.commitNewExecution(
      campaignId,
      async (campaign, executions, allExecutions, senderAccounts) => {
        if (!this.firstHeld) {
          this.firstHeld = true;
          // Hold the first committer open until the second launch has at least
          // tried to enter. A non-atomic store lets the second proceed here and
          // double-send; a serialized store keeps the second outside until the
          // first commit completes.
          await Promise.race([
            this.secondEntered,
            new Promise<void>((resolve) => setTimeout(resolve, 200))
          ]);
        }
        return launch(campaign, executions, allExecutions, senderAccounts);
      }
    );
  }
}

class SenderRestrictedBeforeCommitStore extends InMemoryCampaignStore {
  private restricted = false;

  override async commitNewExecution<T>(
    campaignId: string,
    launch: (
      campaign: Campaign,
      executions: CampaignExecutionRecord[],
      allExecutions: CampaignExecutionRecord[],
      senderAccounts: SenderAccount[]
    ) => Promise<CampaignLaunchCommit<T> | null>
  ): Promise<T | null> {
    if (!this.restricted) {
      this.restricted = true;
      await this.appendSenderRiskEvent("sender-a", {
        kind: "restriction",
        note: "Sender became restricted immediately before execution commit"
      });
    }

    return super.commitNewExecution(campaignId, launch);
  }
}

describe("concurrent campaign executions", () => {
  it("does not double-send to the same creator when two launches race", async () => {
    const store = new BarrierExecutionStore();
    const app = await buildServer({ store, webhookSecret: "x".repeat(16) });

    const create = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@race_creator"],
        message: "Hey - loved your content.",
        campaign: "race-campaign",
        settings: { senderPool: ["sender-a"] }
      }
    });
    expect(create.statusCode).toBe(202);
    const campaignId = create.json().campaignId;

    const body = {
      adapter: { kind: "mock" },
      approvals: {
        actor: "auditor",
        approvedTargets: ["@race_creator"],
        rejectedTargets: []
      }
    };

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/campaigns/${campaignId}/executions`,
        payload: body
      }),
      app.inject({
        method: "POST",
        url: `/campaigns/${campaignId}/executions`,
        payload: body
      })
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    // Exactly one launch succeeds; the superseded one is a 409 conflict.
    expect(statuses).toEqual([200, 409]);

    const list = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions`
    });
    const executions: CampaignExecutionRecord[] =
      list.json().executions ?? list.json();

    const totalSentIntents = executions.reduce(
      (sum, execution) => sum + (execution.intents?.length ?? 0),
      0
    );
    // The single creator is contacted at most once across all executions.
    expect(totalSentIntents).toBe(1);

    await app.close();
  });

  it("still allows distinct scheduled targets to launch in separate executions", async () => {
    const app = await buildServer({
      store: new InMemoryCampaignStore(),
      webhookSecret: "x".repeat(16)
    });

    const create = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@first_target", "@second_target"],
        message: "Hey - loved your content.",
        campaign: "multi-exec-campaign",
        settings: { senderPool: ["sender-a"] }
      }
    });
    const campaignId = create.json().campaignId;

    const first = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "mock" },
        approvals: { actor: "first", approvedTargets: ["@first_target"], rejectedTargets: [] }
      }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().intents).toHaveLength(1);

    const second = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "mock" },
        approvals: { actor: "second", approvedTargets: ["@second_target"], rejectedTargets: [] }
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().intents).toHaveLength(1);
    expect(second.json().intents[0].targetHandle).toBe("second_target");

    await app.close();
  });

  it("rechecks managed sender health from the fresh commit snapshot", async () => {
    const app = await buildServer({
      store: new SenderRestrictedBeforeCommitStore(),
      webhookSecret: "x".repeat(16)
    });

    await app.inject({
      method: "PUT",
      url: "/senders/sender-a",
      payload: {
        dailyLimit: 20
      }
    });
    const create = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@just_restricted_creator"],
        message: "Hey - loved your content.",
        campaign: "sender-restricted-before-commit",
        settings: {
          senderPool: ["sender-a"]
        }
      }
    });
    expect(create.statusCode).toBe(202);
    const campaignId = create.json().campaignId;

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@just_restricted_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });

    const execution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "mock" }
      }
    });

    expect(execution.statusCode).toBe(409);
    expect(execution.json().message).toContain("Sender account(s) unavailable");
    expect(execution.json().message).toContain("sender-a");

    const executions = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions`
    });
    expect(executions.json().executions).toEqual([]);

    await app.close();
  });
});
