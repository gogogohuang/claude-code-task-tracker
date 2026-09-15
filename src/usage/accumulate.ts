import { AccumulateStep, ParsedEvent, SessionUsageStats } from "./types.js";

const RECENT_MESSAGE_ID_LIMIT = 30;

export function accumulate(
  prev: SessionUsageStats,
  events: ParsedEvent[],
): { next: SessionUsageStats; steps: AccumulateStep[] } {
  let stats = prev;
  const steps: AccumulateStep[] = [];

  for (const event of events) {
    if (event.title !== undefined && stats.title === undefined) {
      stats = { ...stats, title: event.title };
    }
    if (event.isSidechain) continue;

    if (event.userText !== undefined && stats.firstPrompt === undefined) {
      stats = { ...stats, firstPrompt: event.userText };
    }

    if (event.toolResultChars) {
      steps.push({ event, statsBefore: stats, statsAfter: stats });
      continue;
    }

    if (!event.usage) continue;
    if (event.messageId && stats.recentMessageIds.includes(event.messageId)) continue;

    const statsBefore = stats;
    const recentMessageIds = event.messageId
      ? [...stats.recentMessageIds, event.messageId].slice(-RECENT_MESSAGE_ID_LIMIT)
      : stats.recentMessageIds;
    const mainThreadMsgCount = stats.mainThreadMsgCount + 1;
    const cacheCreationTotal = stats.cacheCreationTotal + event.usage.cacheCreation;

    stats = {
      ...stats,
      mainThreadMsgCount,
      sessionStartedAt: stats.sessionStartedAt ?? event.timestamp,
      lastMsgAt: event.timestamp ?? stats.lastMsgAt,
      cacheCreationTotal,
      cacheCreationRollingAvg: cacheCreationTotal / mainThreadMsgCount,
      recentMessageIds,
      lastOccupiedTokens: event.usage.input + event.usage.cacheRead + event.usage.cacheCreation,
      lastCacheRead: event.usage.cacheRead,
      lastCacheCreation: event.usage.cacheCreation,
      lastInput: event.usage.input,
    };

    steps.push({ event, statsBefore, statsAfter: stats });
  }

  return { next: stats, steps };
}
