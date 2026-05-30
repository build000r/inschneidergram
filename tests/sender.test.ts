import {
  availableSenderAccounts,
  buildSenderInventory,
  createSenderAccount,
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
});
