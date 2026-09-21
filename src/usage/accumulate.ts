import { AccumulateStep, ParsedEvent, SessionUsageStats } from "./types.js";
import { estimateTokensFromChars } from "./detect.js";
import { appendToolCallLog, emptyToolInventory, recordToolUse } from "./tool-inventory.js";

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

    if (event.toolUseName) {
      const statsBefore = stats;
      const toolInventory = recordToolUse(stats.toolInventory ?? emptyToolInventory(), event.toolUseName);
      let readPathCounts = stats.readPathCounts ?? {};
      if (event.toolUseName === "Read" && event.toolUsePath) {
        const path = event.toolUsePath;
        readPathCounts = { ...readPathCounts, [path]: (readPathCounts[path] ?? 0) + 1 };
      }
      const toolCallLog = appendToolCallLog(stats.toolCallLog ?? [], {
        at: event.timestamp,
        toolName: event.toolUseName,
        path: event.toolUsePath,
        summary: event.toolUseSummary,
        toolUseId: event.toolUseId,
      });
      stats = { ...stats, toolInventory, readPathCounts, toolCallLog };
      steps.push({ event, statsBefore, statsAfter: stats });
      continue;
    }

    if (event.toolResultChars) {
      const resultId = event.toolResultChars.toolUseId;
      const log = stats.toolCallLog;
      if (resultId && log) {
        let idx = log.length - 1;
        while (idx >= 0 && log[idx].toolUseId !== resultId) idx--;
        if (idx >= 0) {
          const resultTokens = estimateTokensFromChars(event.toolResultChars.chars);
          stats = { ...stats, toolCallLog: log.map((entry, i) => (i === idx ? { ...entry, resultTokens, ...(event.toolResultChars?.isError ? { isError: true } : {}) } : entry)) };
        }
      }
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
      workTokensTotal:
        (stats.workTokensTotal ?? 0) + event.usage.input + event.usage.cacheCreation + event.usage.output,
      ...(event.usage.contextWindow !== undefined ? { lastContextWindow: event.usage.contextWindow } : {}),
    };

    steps.push({ event, statsBefore, statsAfter: stats });
  }

  return { next: stats, steps };
}
