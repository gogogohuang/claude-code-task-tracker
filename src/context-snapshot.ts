import { Activity } from "./schema.js";

export const CONTEXT_WINDOW_TOKENS = 1_000_000;

export interface LastTurnUsage {
  occupiedTokens: number;
  cacheRead: number;
  cacheCreation: number;
  input: number;
}

export function formatOccupiedTokensLine(lastOccupiedTokens: number | undefined): string {
  if (lastOccupiedTokens === undefined) return "還沒有用量資料";
  const pct = Math.round((lastOccupiedTokens / CONTEXT_WINDOW_TOKENS) * 100);
  return `窗口約 ${lastOccupiedTokens.toLocaleString("en-US")} token（約 ${pct}%）`;
}

export function formatLastTurnBreakdownLine(usage: LastTurnUsage | undefined): string | undefined {
  if (!usage) return undefined;
  return `上一輪 cache read ${usage.cacheRead.toLocaleString("en-US")} · cache create ${usage.cacheCreation.toLocaleString("en-US")} · input ${usage.input.toLocaleString("en-US")}`;
}

export function lastTurnUsageFromStats(stats: {
  lastOccupiedTokens?: number;
  lastCacheRead?: number;
  lastCacheCreation?: number;
  lastInput?: number;
} | undefined): LastTurnUsage | undefined {
  if (
    stats?.lastOccupiedTokens === undefined ||
    stats.lastCacheRead === undefined ||
    stats.lastCacheCreation === undefined ||
    stats.lastInput === undefined
  ) {
    return undefined;
  }
  return {
    occupiedTokens: stats.lastOccupiedTokens,
    cacheRead: stats.lastCacheRead,
    cacheCreation: stats.lastCacheCreation,
    input: stats.lastInput,
  };
}

export function activityLineLabel(activity: Activity): string {
  const body =
    activity.summary ??
    (activity.phase === "running" ? `正在使用 ${activity.toolName}` : `已使用 ${activity.toolName}`);
  const withTool = `${activity.toolName} · ${body}`;
  return activity.phase === "running" ? `◐ ${withTool}` : withTool;
}

export function formatSnapshotActivityLine(input: {
  activity?: Activity;
  done: number;
  total: number;
}): string | undefined {
  if (!input.activity && input.total === 0) return undefined;
  const taskPart = `任務 ${input.done}/${input.total}`;
  if (!input.activity) return taskPart;
  return `${activityLineLabel(input.activity)} · ${taskPart}`;
}
