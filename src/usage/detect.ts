import { contextOccupancyPct } from "../context-snapshot.js";
import { AccumulateStep, Advice, SessionUsageStats } from "./types.js";

const LONG_SESSION_MSG_THRESHOLD = 200;
const LONG_SESSION_MINUTES_THRESHOLD = 90;
const CACHE_SPIKE_FLOOR = 20000;
const CACHE_SPIKE_MULTIPLIER = 5;
const CACHE_SPIKE_MIN_PRIOR_MSGS = 5;
/** tool_result 沒有 API 算好的 token 數，只能用字元數粗估；中英文混合實際比例會有出入。 */
const CHARS_PER_TOKEN_ESTIMATE = 4;
const FAT_TOOL_RESULT_TOKENS = 8000;
const HEAVY_BASELINE_TOKENS = 50000;
const REPEATED_READ_THRESHOLD = 3;

function estimateTokensFromChars(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN_ESTIMATE);
}

function isCodex(stats: SessionUsageStats): boolean {
  return stats.agent === "codex";
}

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
      message: isCodex(after)
        ? `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再另開新 session（這個 session 已經 ${after.mainThreadMsgCount.toLocaleString("en-US")} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`
        : `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再執行 /clear 或另開新 session（這個 session 已經 ${after.mainThreadMsgCount.toLocaleString("en-US")} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`,
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
      message: isCodex(before)
        ? `這一輪重算了 ${usage.cacheCreation.toLocaleString("en-US")} token（平常 ${Math.round(before.cacheCreationRollingAvg).toLocaleString("en-US")}），可能是閒置太久 cache 過期或 context 被改動；長時間離開後建議另開新 session。`
        : `現在 /clear 或開新 session，別在這個 session 裡繼續換工具/MCP 設定（剛剛這一輪因此重算了 ${usage.cacheCreation.toLocaleString("en-US")} token，平常只要 ${Math.round(before.cacheCreationRollingAvg).toLocaleString("en-US")}）。`,
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
      message: isCodex(before)
        ? `開場偏重（第一輪就吃了 ${usage.cacheCreation.toLocaleString("en-US")} token）；檢查 AGENTS.md、啟用的 MCP／plugin 與 skill 有沒有太多。`
        : `開場偏重（第一輪就吃了 ${usage.cacheCreation.toLocaleString("en-US")} token）；下方是可能來源，也可執行 task-tracker inspect 細看。`,
    },
  ];
}

function checkFatToolResult(stats: SessionUsageStats, step: AccumulateStep): Advice[] {
  const toolResultChars = step.event.toolResultChars;
  if (!toolResultChars) return [];
  const estTokens = estimateTokensFromChars(toolResultChars.chars);
  if (estTokens <= FAT_TOOL_RESULT_TOKENS) return [];
  const tokens = estTokens.toLocaleString("en-US");
  const pct = contextOccupancyPct(estTokens, stats.lastContextWindow);
  const isSubagent = toolResultChars.toolName === "Agent" || toolResultChars.toolName === "SubagentHandback";
  if (isSubagent) {
    return [
      {
        sessionId: stats.sessionId,
        kind: "fat-tool-result",
        at: step.event.timestamp ?? new Date().toISOString(),
        message: `下次派子 agent 只讓它交回結論與檔案路徑，不要把完整 diff/review 貼回主線（剛剛回傳約 ${tokens} token，約占 context window ${pct}%）。`,
      },
    ];
  }
  const tool = toolResultChars.toolName ?? "工具";
  const pathPart = toolResultChars.path ? `（${toolResultChars.path}）` : "";
  return [
    {
      sessionId: stats.sessionId,
      kind: "fat-tool-result",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: isCodex(stats)
        ? `重跑剛剛那個 ${tool} 呼叫，加上 head/grep 把輸出縮小（原本回傳約 ${tokens} token，約占 context window ${pct}%）。`
        : `重跑剛剛那個 ${tool} 呼叫${pathPart}，加上 head/grep/limit 或 Read 的 offset/limit 把輸出縮小（原本回傳約 ${tokens} token，約占 context window ${pct}%）。`,
    },
  ];
}

function checkRepeatedRead(before: SessionUsageStats, after: SessionUsageStats, step: AccumulateStep): Advice[] {
  const path = step.event.toolUsePath;
  if (!path || step.event.toolUseName !== "Read") return [];
  const prev = before.readPathCounts?.[path] ?? 0;
  const next = after.readPathCounts?.[path] ?? 0;
  if (prev >= REPEATED_READ_THRESHOLD || next < REPEATED_READ_THRESHOLD) return [];
  return [
    {
      sessionId: after.sessionId,
      kind: "repeated-read",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `同一個檔案已 Read ${next} 次（${path}）；下次加 offset/limit，或先寫進 plan 再 /clear。`,
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
    advice.push(...checkRepeatedRead(step.statsBefore, step.statsAfter, step));
  }
  return advice;
}
