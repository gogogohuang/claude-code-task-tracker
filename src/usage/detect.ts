import { CODEX_CONTEXT_WINDOW_TOKENS, contextOccupancyPct } from "../context-snapshot.js";
import { formatTokenCount } from "../usage-overview.js";
import { AccumulateStep, Advice, AdviceSeverity, SessionUsageStats } from "./types.js";

const LONG_SESSION_MSG_THRESHOLD = 200;
const LONG_SESSION_MINUTES_THRESHOLD = 90;
const CACHE_SPIKE_FLOOR = 20000;
const CACHE_SPIKE_MULTIPLIER = 5;
const CACHE_SPIKE_MIN_PRIOR_MSGS = 5;
/** tool_result 沒有 API 算好的 token 數，只能用字元數粗估；中英文混合實際比例會有出入。 */
const CHARS_PER_TOKEN_ESTIMATE = 4;
export const FAT_TOOL_RESULT_TOKENS = 8000;
const HEAVY_BASELINE_TOKENS = 50000;
const REPEATED_READ_THRESHOLD = 3;
/** 超過門檻多少倍才從 warn 升級成 critical，統一套用在所有 advice 種類。 */
const CRITICAL_OVERAGE_MULTIPLIER = 2;

/** actual 相對 threshold 超過 CRITICAL_OVERAGE_MULTIPLIER 倍才算 critical，否則 warn。 */
function severityForOverage(actual: number, threshold: number): AdviceSeverity {
  return actual >= threshold * CRITICAL_OVERAGE_MULTIPLIER ? "critical" : "warn";
}

export function estimateTokensFromChars(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN_ESTIMATE);
}

/** 供 history 面板判斷單次工具呼叫是否過肥；未過門檻回 undefined。 */
export function fatToolResultSeverity(estTokens: number): AdviceSeverity | undefined {
  if (estTokens <= FAT_TOOL_RESULT_TOKENS) return undefined;
  return severityForOverage(estTokens, FAT_TOOL_RESULT_TOKENS);
}

function isCodex(stats: SessionUsageStats): boolean {
  return stats.agent === "codex";
}

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

export function elapsedMinutes(stats: SessionUsageStats): number {
  if (!stats.sessionStartedAt || !stats.lastMsgAt) return 0;
  return minutesBetween(stats.sessionStartedAt, stats.lastMsgAt);
}

/** 87 → "87 分鐘"、187 → "3 小時 7 分鐘"、180 → "3 小時"（整點不附「0 分鐘」）。 */
export function formatElapsedMinutes(minutes: number): string {
  const totalMinutes = Math.round(minutes);
  if (totalMinutes < 60) return `${totalMinutes.toLocaleString("en-US")} 分鐘`;
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  return remainder === 0 ? `${hours} 小時` : `${hours} 小時 ${remainder} 分鐘`;
}

function isLongSession(stats: SessionUsageStats): boolean {
  return stats.mainThreadMsgCount > LONG_SESSION_MSG_THRESHOLD || elapsedMinutes(stats) > LONG_SESSION_MINUTES_THRESHOLD;
}

function checkLongSession(before: SessionUsageStats, after: SessionUsageStats): Advice[] {
  if (isLongSession(before) || !isLongSession(after)) return [];
  const minutes = elapsedMinutes(after);
  const msgRatio = after.mainThreadMsgCount / LONG_SESSION_MSG_THRESHOLD;
  const minuteRatio = minutes / LONG_SESSION_MINUTES_THRESHOLD;
  const severity: AdviceSeverity = Math.max(msgRatio, minuteRatio) >= 1.5 ? "critical" : "warn";
  return [
    {
      sessionId: after.sessionId,
      kind: "long-session",
      at: after.lastMsgAt ?? new Date().toISOString(),
      severity,
      summary: `這個 session 已經 ${after.mainThreadMsgCount.toLocaleString("en-US")} 則訊息、開了 ${formatElapsedMinutes(minutes)}（門檻 200 則／90 分鐘）。`,
      action: isCodex(after)
        ? `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再另開新 session。`
        : `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再執行 /clear 或另開新 session。`,
    },
  ];
}

function checkCacheSpike(before: SessionUsageStats, step: AccumulateStep): Advice[] {
  const usage = step.event.usage;
  if (!usage) return [];
  if (before.mainThreadMsgCount < CACHE_SPIKE_MIN_PRIOR_MSGS) return [];
  const threshold = Math.max(CACHE_SPIKE_FLOOR, CACHE_SPIKE_MULTIPLIER * before.cacheCreationRollingAvg);
  if (usage.cacheCreation <= threshold) return [];
  const tokens = formatTokenCount(usage.cacheCreation);
  const avg = before.cacheCreationRollingAvg;
  const ratioToAvg = avg > 0 ? Math.round(usage.cacheCreation / avg) : undefined;
  const comparedToAvg =
    ratioToAvg !== undefined
      ? `，是平常 ${formatTokenCount(avg)} 的 ${ratioToAvg} 倍（門檻 ${CACHE_SPIKE_MULTIPLIER} 倍）`
      : `（平常只要 ${formatTokenCount(avg)}）`;
  return [
    {
      sessionId: before.sessionId,
      kind: "cache-spike",
      at: step.event.timestamp ?? new Date().toISOString(),
      severity: severityForOverage(usage.cacheCreation, threshold),
      estTokens: usage.cacheCreation,
      summary: isCodex(before)
        ? `這一輪重算了 ${tokens} token${comparedToAvg}，可能是閒置太久 cache 過期或 context 被改動。`
        : `這一輪重算了 ${tokens} token${comparedToAvg}。`,
      action: isCodex(before)
        ? `長時間離開後建議另開新 session。`
        : `現在 /clear 或開新 session，別在這個 session 裡繼續換工具/MCP 設定。`,
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
      severity: severityForOverage(usage.cacheCreation, HEAVY_BASELINE_TOKENS),
      estTokens: usage.cacheCreation,
      summary: `開場偏重（第一輪就吃了 ${formatTokenCount(usage.cacheCreation)} token，門檻 ${formatTokenCount(HEAVY_BASELINE_TOKENS)}）。`,
      action: isCodex(before)
        ? `檢查 AGENTS.md、啟用的 MCP／plugin 與 skill 有沒有太多。`
        : `下方是可能來源，也可執行 task-tracker inspect 細看。`,
    },
  ];
}

function checkFatToolResult(stats: SessionUsageStats, step: AccumulateStep): Advice[] {
  const toolResultChars = step.event.toolResultChars;
  if (!toolResultChars) return [];
  const estTokens = estimateTokensFromChars(toolResultChars.chars);
  if (estTokens <= FAT_TOOL_RESULT_TOKENS) return [];
  const tokens = formatTokenCount(estTokens);
  const pct = contextOccupancyPct(
    estTokens,
    stats.lastContextWindow ?? (isCodex(stats) ? CODEX_CONTEXT_WINDOW_TOKENS : undefined),
  );
  const severity = severityForOverage(estTokens, FAT_TOOL_RESULT_TOKENS);
  const thresholdTokens = formatTokenCount(FAT_TOOL_RESULT_TOKENS);
  const isSubagent = toolResultChars.toolName === "Agent" || toolResultChars.toolName === "SubagentHandback";
  if (isSubagent) {
    return [
      {
        sessionId: stats.sessionId,
        kind: "fat-tool-result",
        at: step.event.timestamp ?? new Date().toISOString(),
        severity,
        estTokens,
        summary: `子 agent 這次回傳約 ${tokens} token，約占 context window ${pct}%（門檻 ${thresholdTokens}）。`,
        action: `下次派子 agent 只讓它交回結論與檔案路徑，不要把完整 diff/review 貼回主線。`,
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
      severity,
      estTokens,
      target: toolResultChars.path,
      summary: `${tool}${pathPart} 這次回傳約 ${tokens} token，約占 context window ${pct}%（門檻 ${thresholdTokens}）。`,
      action: isCodex(stats)
        ? `重跑剛剛那個呼叫，加上 head/grep 把輸出縮小。`
        : `重跑剛剛那個呼叫，加上 head/grep/limit 或 Read 的 offset/limit 把輸出縮小。`,
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
      severity: severityForOverage(next, REPEATED_READ_THRESHOLD),
      target: path,
      summary: `同一個檔案已 Read ${next} 次（${path}），門檻 ${REPEATED_READ_THRESHOLD} 次。`,
      action: `下次加 offset/limit，或先寫進 plan 再 /clear。`,
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
