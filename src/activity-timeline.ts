import type { ToolCallLogEntry } from "./usage/tool-inventory.js";

export const TIMELINE_MAX = 40;

export interface TimelineEntry {
  at: string;
  toolName: string;
  phase: "running" | "done";
  summary?: string;
  resultTokens?: number;
}

/**
 * 把 transcript 回填出的完整 session 工具呼叫紀錄轉成 timeline 項目，供 h 面板在選到 session
 * 那一刻先墊底，之後才接上即時 push——這樣切走再切回同一個 session 也不會遺失先前的呼叫順序。
 */
export function toolCallLogToTimeline(log: ToolCallLogEntry[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const entry of log) {
    if (entry.at === undefined) continue;
    entries.push({
      at: entry.at,
      toolName: entry.toolName,
      phase: "done",
      summary: entry.summary ?? entry.path,
      ...(entry.resultTokens !== undefined ? { resultTokens: entry.resultTokens } : {}),
    });
  }
  return entries;
}

export function pushActivityToTimeline(
  prev: TimelineEntry[],
  activity: TimelineEntry | undefined,
  max: number = TIMELINE_MAX,
): TimelineEntry[] {
  if (!activity) return prev;
  const last = prev.at(-1);
  if (last && last.at === activity.at && last.phase === activity.phase && last.toolName === activity.toolName) {
    return prev;
  }
  let next: TimelineEntry[];
  if (activity.phase === "done" && last?.phase === "running" && last.toolName === activity.toolName) {
    next = [...prev.slice(0, -1), activity];
  } else {
    next = [...prev, activity];
  }
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}
