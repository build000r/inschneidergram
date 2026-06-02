import { z } from "zod";

export const senderAccountStatuses = [
  "healthy",
  "cooldown",
  "locked",
  "reconnect_required"
] as const;

export const senderRiskEventKinds = [
  "warning",
  "restriction",
  "lockout",
  "reconnect_required",
  "manual_note"
] as const;

export type SenderAccountStatus = (typeof senderAccountStatuses)[number];
export type SenderRiskEventKind = (typeof senderRiskEventKinds)[number];

export interface SenderRiskEvent {
  kind: SenderRiskEventKind;
  at: string;
  note: string;
}

export interface SenderAccount {
  id: string;
  status: SenderAccountStatus;
  dailyLimit: number;
  cooldownUntil?: string;
  warmupNote?: string;
  riskEvents: SenderRiskEvent[];
}

export interface SenderAccountHealth {
  id: string;
  status: SenderAccountStatus;
  available: boolean;
  dailyLimit: number;
  cooldownUntil?: string;
  warmupNote?: string;
  blockers: string[];
  riskEvents: SenderRiskEvent[];
}

export interface SenderInventoryHealth {
  total: number;
  available: number;
  blocked: number;
  accounts: SenderAccountHealth[];
}

export const senderRiskEventSchema = z.object({
  kind: z.enum(senderRiskEventKinds),
  at: z.string().datetime(),
  note: z.string().min(1).max(1000)
});

export const senderAccountSchema = z.object({
  id: z.string().min(1).max(120),
  status: z.enum(senderAccountStatuses).default("healthy"),
  dailyLimit: z.number().int().min(1).max(200),
  cooldownUntil: z.string().datetime().optional(),
  warmupNote: z.string().min(1).max(1000).optional(),
  riskEvents: z.array(senderRiskEventSchema).default([])
});

export type SenderAccountInput = z.input<typeof senderAccountSchema>;

const senderRiskEventInputSchema = z.object({
  kind: z.enum(senderRiskEventKinds),
  at: z.string().datetime().optional(),
  note: z.string().min(1).max(1000),
  status: z.enum(senderAccountStatuses).optional(),
  cooldownUntil: z.string().datetime().optional(),
  warmupNote: z.string().min(1).max(1000).optional()
});

export type SenderRiskEventInput = z.input<typeof senderRiskEventInputSchema>;

export function createSenderAccount(input: unknown): SenderAccount {
  return senderAccountSchema.parse(input);
}

export function recordSenderRiskEvent(
  account: SenderAccount,
  input: unknown,
  now = new Date()
): SenderAccount {
  const event = senderRiskEventInputSchema.parse(input);
  const status = event.status ?? statusForRiskEvent(event.kind, account.status);

  return createSenderAccount({
    ...account,
    status,
    cooldownUntil:
      event.cooldownUntil ?? (status === "cooldown" ? account.cooldownUntil : undefined),
    warmupNote: event.warmupNote ?? account.warmupNote,
    riskEvents: [
      ...account.riskEvents,
      {
        kind: event.kind,
        at: event.at ?? now.toISOString(),
        note: event.note
      }
    ]
  });
}

export function buildSenderInventory(
  senderPool: string[],
  defaultDailyLimit: number,
  senderAccounts: SenderAccountInput[] | undefined
): SenderAccount[] {
  assertUnique(senderPool, "sender account id");

  if (senderAccounts && senderAccounts.length > 0) {
    const accounts = senderAccounts.map(createSenderAccount);
    assertUnique(accounts.map((account) => account.id), "sender account id");
    return accounts;
  }

  return senderPool.map((id) =>
    createSenderAccount({
      id,
      status: "healthy",
      dailyLimit: defaultDailyLimit,
      riskEvents: []
    })
  );
}

export function summarizeSenderInventory(
  accounts: SenderAccount[],
  now = new Date()
): SenderInventoryHealth {
  const accountHealth = accounts.map((account) => summarizeSenderAccount(account, now));
  const available = accountHealth.filter((account) => account.available).length;

  return {
    total: accountHealth.length,
    available,
    blocked: accountHealth.length - available,
    accounts: accountHealth
  };
}

export function summarizeSenderAccount(
  account: SenderAccount,
  now = new Date()
): SenderAccountHealth {
  const blockers: string[] = [];
  const cooldownActive =
    account.status === "cooldown" &&
    (!account.cooldownUntil || Date.parse(account.cooldownUntil) > now.getTime());

  if (cooldownActive) {
    blockers.push(account.cooldownUntil ? `cooldown_until:${account.cooldownUntil}` : "cooldown");
  }

  if (account.status === "locked") {
    blockers.push("locked");
  }

  if (account.status === "reconnect_required") {
    blockers.push("reconnect_required");
  }

  return {
    id: account.id,
    status: account.status,
    available: blockers.length === 0,
    dailyLimit: account.dailyLimit,
    cooldownUntil: account.cooldownUntil,
    warmupNote: account.warmupNote,
    blockers,
    riskEvents: account.riskEvents.map((event) => ({ ...event }))
  };
}

export function availableSenderAccounts(
  accounts: SenderAccount[],
  now = new Date()
): SenderAccount[] {
  return accounts.filter((account) => summarizeSenderAccount(account, now).available);
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function statusForRiskEvent(
  kind: SenderRiskEventKind,
  current: SenderAccountStatus
): SenderAccountStatus {
  switch (kind) {
    case "restriction":
      return "cooldown";
    case "lockout":
      return "locked";
    case "reconnect_required":
      return "reconnect_required";
    case "warning":
    case "manual_note":
      return current;
  }
}
