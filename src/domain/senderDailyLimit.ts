import type { SendIntent } from "./delivery.js";
import type { SenderDailyLimitUsage } from "./sender.js";
import { senderDailyLimitDay } from "./sender.js";
import type { CampaignExecutionRecord } from "./store.js";

export function senderDailyLimitUsageFromExecutions(
  executions: CampaignExecutionRecord[],
  now = new Date()
): Map<string, SenderDailyLimitUsage> {
  const day = senderDailyLimitDay(now);
  const counts = new Map<string, number>();

  for (const execution of executions) {
    if (senderDailyLimitDay(new Date(execution.createdAt)) !== day) {
      continue;
    }

    for (const intent of execution.intents) {
      counts.set(intent.senderAccountId, (counts.get(intent.senderAccountId) ?? 0) + 1);
    }
  }

  return usageMapFromCounts(counts, day);
}

export function addSenderDailyLimitUsage(
  usage: ReadonlyMap<string, SenderDailyLimitUsage>,
  intents: SendIntent[],
  now = new Date()
): Map<string, SenderDailyLimitUsage> {
  const day = senderDailyLimitDay(now);
  const counts = new Map<string, number>();

  for (const [senderId, current] of usage) {
    counts.set(senderId, current.day === day ? current.count : 0);
  }

  for (const intent of intents) {
    counts.set(intent.senderAccountId, (counts.get(intent.senderAccountId) ?? 0) + 1);
  }

  return usageMapFromCounts(counts, day);
}

function usageMapFromCounts(
  counts: ReadonlyMap<string, number>,
  day: string
): Map<string, SenderDailyLimitUsage> {
  return new Map(
    [...counts.entries()].map(([senderId, count]) => [
      senderId,
      {
        day,
        count
      }
    ])
  );
}
