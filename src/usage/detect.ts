import { AccumulateStep, Advice, SessionUsageStats } from "./types.js";

const LONG_SESSION_MSG_THRESHOLD = 200;
const LONG_SESSION_MINUTES_THRESHOLD = 90;
const CACHE_SPIKE_FLOOR = 20000;
const CACHE_SPIKE_MULTIPLIER = 5;
const CACHE_SPIKE_MIN_PRIOR_MSGS = 5;
const FAT_TOOL_RESULT_CHARS = 30000;
const HEAVY_BASELINE_TOKENS = 50000;

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

function elapsedMinutes(stats: SessionUsageStats): number {
  if (!stats.sessionStartedAt || !stats.lastMsgAt) return 0;
  return minutesBetween(stats.sessionStartedAt, stats.lastMsgAt);
}

function isLongSession(stats: SessionUsageStats): boolean {
  return stats.mainThreadMsgCount > LONG_SESSION_MSG_THRESHOLD || elapsedMinutes(stats) > LONG_SESSION_MINUTES_THRESHOLD;
}

function checkLongSession(before: SessionUsageStats, after: SessionUsageStats): Advice[] {
  if (isLongSession(before) || !isLongSession(after)) return [];
  return [
    {
      sessionId: after.sessionId,
      kind: "long-session",
      at: after.lastMsgAt ?? new Date().toISOString(),
      message: `現在執行 /clear 或另開新 session（這個 session 已經 ${after.mainThreadMsgCount} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`,
    },
  ];
}

function checkCacheSpike(before: SessionUsageStats, step: AccumulateStep): Advice[] {
  const usage = step.event.usage;
  if (!usage) return [];
  if (before.mainThreadMsgCount < CACHE_SPIKE_MIN_PRIOR_MSGS) return [];
  const threshold = Math.max(CACHE_SPIKE_FLOOR, CACHE_SPIKE_MULTIPLIER * before.cacheCreationRollingAvg);
  if (usage.cacheCreation <= threshold) return [];
  return [
    {
      sessionId: before.sessionId,
      kind: "cache-spike",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `現在 /clear 或開新 session，別在這個 session 裡繼續換工具/MCP 設定（剛剛這一輪因此重算了 ${usage.cacheCreation.toLocaleString("en-US")} token，平常只要 ${Math.round(before.cacheCreationRollingAvg).toLocaleString("en-US")}）。`,
    },
  ];
}

function checkHeavyBaseline(before: SessionUsageStats, step: AccumulateStep): Advice[] {
  const usage = step.event.usage;
  if (!usage) return [];
  if (before.mainThreadMsgCount !== 0) return [];
  if (usage.cacheCreation <= HEAVY_BASELINE_TOKENS) return [];
  return [
    {
      sessionId: before.sessionId,
      kind: "heavy-baseline",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `執行 task-tracker inspect 檢查這個專案載入 prompt 的東西（這個 session 開場第一輪就吃了 ${usage.cacheCreation.toLocaleString("en-US")} token）。`,
    },
  ];
}

function checkFatToolResult(stats: SessionUsageStats, step: AccumulateStep): Advice[] {
  const toolResultChars = step.event.toolResultChars;
  if (!toolResultChars) return [];
  if (toolResultChars.chars <= FAT_TOOL_RESULT_CHARS) return [];
  const toolName = toolResultChars.toolName ?? "工具";
  return [
    {
      sessionId: stats.sessionId,
      kind: "fat-tool-result",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `重跑剛剛那個 ${toolName} 呼叫，加上 head/grep/limit 把輸出縮小（原本回傳了 ${toolResultChars.chars.toLocaleString("en-US")} 字元）。`,
    },
  ];
}

export function detect(_prev: SessionUsageStats, _next: SessionUsageStats, steps: AccumulateStep[]): Advice[] {
  const advice: Advice[] = [];
  for (const step of steps) {
    advice.push(...checkLongSession(step.statsBefore, step.statsAfter));
    advice.push(...checkCacheSpike(step.statsBefore, step));
    advice.push(...checkHeavyBaseline(step.statsBefore, step));
    advice.push(...checkFatToolResult(step.statsAfter, step));
  }
  return advice;
}
