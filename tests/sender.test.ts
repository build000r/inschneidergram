import {
  availableSenderAccounts,
  buildSenderInventory,
  createSenderAccount,
  recordSenderRiskEvent,
  summarizeSenderInventory
} from "../src/domain/sender.js";

describe("sender account health", () => {
  it("tracks limits, warm-up notes, cooldowns, reconnect state, and risk events", () => {
    const healthy = createSenderAccount({
      id: "sender-a",
      status: "healthy",
      dailyLimit: 25,
      warmupNote: "day 4 warm-up, keep replies manual",
      riskEvents: [
        {
          kind: "manual_note",
          at: "2026-05-30T00:00:00.000Z",
          note: "Recovered after password rotation"
        }
      ]
    });
    const cooldown = createSenderAccount({
      id: "sender-b",
      status: "cooldown",
      dailyLimit: 10,
      cooldownUntil: "2026-05-30T02:00:00.000Z",
      riskEvents: [
        {
          kind: "warning",
          at: "2026-05-30T00:30:00.000Z",
          note: "Provider reported temporary send warning"
        }
      ]
    });
    const reconnectRequired = createSenderAccount({
      id: "sender-c",
      status: "reconnect_required",
      dailyLimit: 10,
      riskEvents: [
        {
          kind: "reconnect_required",
          at: "2026-05-30T00:45:00.000Z",
          note: "Session cookie expired"
        }
      ]
    });

    const summary = summarizeSenderInventory(
      [healthy, cooldown, reconnectRequired],
      new Date("2026-05-30T01:00:00.000Z")
    );

    expect(summary).toMatchObject({
      total: 3,
      available: 1,
      blocked: 2,
      accounts: [
        {
          id: "sender-a",
          available: true,
          dailyLimit: 25,
          warmupNote: "day 4 warm-up, keep replies manual"
        },
        {
          id: "sender-b",
          available: false,
          blockers: ["cooldown_until:2026-05-30T02:00:00.000Z"]
        },
        {
          id: "sender-c",
          available: false,
          blockers: ["reconnect_required"]
        }
      ]
    });
  });

  it("appends risk events and derives blocking sender states", () => {
    const healthy = createSenderAccount({
      id: "sender-a",
      status: "healthy",
      dailyLimit: 25
    });

    const restricted = recordSenderRiskEvent(
      healthy,
      {
        kind: "restriction",
        note: "Instagram reported a temporary DM restriction"
      },
      new Date("2026-05-30T01:15:00.000Z")
    );

    expect(restricted).toMatchObject({
      id: "sender-a",
      status: "cooldown",
      riskEvents: [
        {
          kind: "restriction",
          at: "2026-05-30T01:15:00.000Z",
          note: "Instagram reported a temporary DM restriction"
        }
      ]
    });
    expect(summarizeSenderInventory([restricted]).accounts[0]).toMatchObject({
      available: false,
      blockers: ["cooldown"]
    });

    expect(
      recordSenderRiskEvent(restricted, {
        kind: "manual_note",
        status: "healthy",
        note: "Operator confirmed the account can send again"
      }).status
    ).toBe("healthy");
  });

  it("only returns senders whose cooldown and account state allow scheduling", () => {
    const inventory = buildSenderInventory(
      ["sender-a", "sender-b"],
      35,
      [
        {
          id: "sender-a",
          status: "cooldown",
          dailyLimit: 10,
          cooldownUntil: "2026-05-30T00:30:00.000Z"
        },
        {
          id: "sender-b",
          status: "locked",
          dailyLimit: 10
        }
      ]
    );

    expect(
      availableSenderAccounts(inventory, new Date("2026-05-30T01:00:00.000Z")).map(
        (account) => account.id
      )
    ).toEqual(["sender-a"]);
  });

  it("marks senders unavailable after their dailyLimit usage is reached", () => {
    const inventory = buildSenderInventory(
      ["sender-a"],
      35,
      [
        {
          id: "sender-a",
          status: "healthy",
          dailyLimit: 2
        }
      ]
    );
    const usage = new Map([
      [
        "sender-a",
        {
          day: "2026-05-30",
          count: 2
        }
      ]
    ]);
    const now = new Date("2026-05-30T12:00:00.000Z");

    expect(summarizeSenderInventory(inventory, now, usage)).toMatchObject({
      available: 0,
      blocked: 1,
      accounts: [
        {
          id: "sender-a",
          available: false,
          dailyUsage: {
            day: "2026-05-30",
            used: 2,
            remaining: 0
          },
          blockers: ["daily_limit_reached:2026-05-30"]
        }
      ]
    });
    expect(availableSenderAccounts(inventory, now, usage)).toEqual([]);
  });

  it("does not carry stale dailyLimit usage into a new UTC day", () => {
    const inventory = buildSenderInventory(
      ["sender-a"],
      35,
      [
        {
          id: "sender-a",
          status: "healthy",
          dailyLimit: 2
        }
      ]
    );
    const staleUsage = new Map([
      [
        "sender-a",
        {
          day: "2026-05-30",
          count: 2
        }
      ]
    ]);
    const now = new Date("2026-05-31T00:00:00.000Z");

    expect(summarizeSenderInventory(inventory, now, staleUsage)).toMatchObject({
      available: 1,
      blocked: 0,
      accounts: [
        {
          id: "sender-a",
          available: true,
          dailyUsage: {
            day: "2026-05-31",
            used: 0,
            remaining: 2
          },
          blockers: []
        }
      ]
    });
    expect(
      availableSenderAccounts(inventory, now, staleUsage).map((account) => account.id)
    ).toEqual(["sender-a"]);
  });

  it("rejects duplicate sender ids before building fallback inventory", () => {
    expect(() => buildSenderInventory(["sender-a", "sender-a"], 35, undefined)).toThrow(
      "Duplicate sender account id: sender-a"
    );
  });
});
