import { Activity } from "./schema.js";
import { resolveLocale } from "./locale.js";
import type { Agent } from "./agent.js";

export const CONTEXT_WINDOW_TOKENS = 1_000_000;
export const CODEX_CONTEXT_WINDOW_TOKENS = 258_400;

export interface LastTurnUsage {
  occupiedTokens: number;
  cacheRead: number;
  cacheCreation: number;
  input: number;
}

const GAUGE_WIDTH = 24;

export function contextOccupancyPct(
  lastOccupiedTokens: number,
  contextWindow: number = CONTEXT_WINDOW_TOKENS,
): number {
  const window = contextWindow > 0 ? contextWindow : CONTEXT_WINDOW_TOKENS;
  return Math.round((lastOccupiedTokens / window) * 100);
}

export function formatContextGaugeBar(
  lastOccupiedTokens: number | undefined,
  contextWindow?: number,
): { bar: string; color: "green" | "yellow" | "red" } | undefined {
  if (lastOccupiedTokens === undefined) return undefined;
  const pct = contextOccupancyPct(lastOccupiedTokens, contextWindow);
  const filled = Math.min(GAUGE_WIDTH, Math.max(0, Math.round((pct / 100) * GAUGE_WIDTH)));
  const bar = `${"█".repeat(filled)}${"░".repeat(GAUGE_WIDTH - filled)}`;
  const color = pct >= 95 ? "red" : pct >= 80 ? "yellow" : "green";
  return { bar, color };
}

export function formatOccupiedTokensLine(lastOccupiedTokens: number | undefined, contextWindow?: number): string {
  if (lastOccupiedTokens === undefined) return "還沒有用量資料";
  const pct = contextOccupancyPct(lastOccupiedTokens, contextWindow);
  return `窗口約 ${lastOccupiedTokens.toLocaleString("en-US")} token（約 ${pct}%）`;
}

export function formatLastTurnBreakdownLine(usage: LastTurnUsage | undefined, agent: Agent = "claude"): string | undefined {
  if (!usage) return undefined;
  if (agent === "codex") {
    return `上一輪 cached ${usage.cacheRead.toLocaleString("en-US")} · 新算 ${usage.cacheCreation.toLocaleString("en-US")}`;
  }
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
  const locale = resolveLocale(process.env);
  const body =
    activity.summary ??
    (locale === "en"
      ? activity.phase === "running"
        ? `Using ${activity.toolName}`
        : `Used ${activity.toolName}`
      : activity.phase === "running"
        ? `正在使用 ${activity.toolName}`
        : `已使用 ${activity.toolName}`);
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
