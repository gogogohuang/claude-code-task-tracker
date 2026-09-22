import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { Agent } from "../agent.js";
import { accumulate } from "./accumulate.js";
import { fingerprintOf, isWarmFingerprint, type FileFingerprint } from "./cache.js";
import { parseCodexRollout } from "./codex-rollout.js";
import { detect } from "./detect.js";
import { applySubagentEvents, createSubagentsState, SubagentsState } from "./subagents.js";
import { createTailState, parseNewContent } from "./tail-transcript.js";
import { Advice, createSessionUsageStats, SessionUsageStats, TailState } from "./types.js";

interface RuntimeEntry {
  tailState: TailState;
  stats: SessionUsageStats;
  subagents: SubagentsState;
  /** 上次成功讀完後的檔指紋；refresh 前比對，沒變就 warm skip。 */
  fingerprint?: FileFingerprint;
}

const sessions = new Map<string, RuntimeEntry>();

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

/**
 * 回傳實際成功讀到的位元組數（bytesRead），不是「想讀多少」。失敗（開檔/讀檔任何一步出錯）
 * 一律 fail open：content 空字串、bytesRead 0 —— 呼叫端要用這個真實數字去推進 offset，
 * 不然讀取失敗時 offset 還是往前跳，會把那段還沒讀到的內容永久跳過。
 */
function readNewBytes(path: string, offset: number, size: number): { content: string; bytesRead: number } {
  if (size <= offset) return { content: "", bytesRead: 0 };
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { content: "", bytesRead: 0 };
  }
  try {
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    return { content: buffer.toString("utf-8", 0, bytesRead), bytesRead };
  } catch {
    return { content: "", bytesRead: 0 };
  } finally {
    closeSync(fd);
  }
}

function runOnce(
  prevTailState: TailState,
  prevStats: SessionUsageStats,
  prevSubagents: SubagentsState,
  content: string,
  bytesRead: number,
  agent: Agent,
): { tailState: TailState; stats: SessionUsageStats; subagents: SubagentsState; advice: Advice[] } {
  const parse = agent === "codex" ? parseCodexRollout : parseNewContent;
  const parsed = parse(content, prevTailState, bytesRead);
  const { next, steps } = accumulate(prevStats, parsed.events);
  const advice = detect(prevStats, next, steps);
  const subagents = applySubagentEvents(prevSubagents, parsed.events);
  return { tailState: parsed.state, stats: next, subagents, advice };
}

export function prime(
  sessionId: string,
  transcriptPath: string,
  agent: Agent = "claude",
): { stats: SessionUsageStats; advice: Advice[] } {
  const stats0 = createSessionUsageStats(sessionId, agent);
  const subagents0 = createSubagentsState();
  const size = fileSize(transcriptPath);
  if (size === undefined) {
    sessions.set(sessionId, { tailState: createTailState(), stats: stats0, subagents: subagents0 });
    return { stats: stats0, advice: [] };
  }
  // offset 要錨在「這次真正讀到多少 bytes」，不能用 size 這個意圖值 —— 讀取失敗時
  // readNewBytes 會回傳 bytesRead:0，offset 就該原地不動，等下一次再重試。
  const { content, bytesRead } = readNewBytes(transcriptPath, 0, size);
  const result = runOnce(createTailState(), stats0, subagents0, content, bytesRead, agent);
  // 讀失敗（有內容但 bytesRead=0）不寫指紋，否則 refresh 會 warm skip 永遠讀不到。
  // 空檔（size=0）可以寫指紋：沒有內容可讀。
  const fingerprint =
    bytesRead > 0 || size === 0 ? fingerprintOf(transcriptPath) : undefined;
  sessions.set(sessionId, {
    tailState: result.tailState,
    stats: result.stats,
    subagents: result.subagents,
    fingerprint,
  });
  return { stats: result.stats, advice: result.advice };
}

export function refresh(sessionId: string, transcriptPath: string, agent: Agent = "claude"): Advice[] {
  const entry = sessions.get(sessionId);
  if (!entry) return prime(sessionId, transcriptPath, agent).advice;

  const currentFp = fingerprintOf(transcriptPath);
  if (!currentFp) return [];
  // warm：mtime + size 都沒變，不重讀（chokidar 誤觸／重繪觸發時幾乎零成本）
  if (isWarmFingerprint(entry.fingerprint, currentFp)) return [];

  const size = currentFp.size;
  if (size < entry.tailState.offset) return prime(sessionId, transcriptPath, agent).advice; // 檔案被截斷/換新，視同重新開始
  if (size === entry.tailState.offset) {
    // size 沒長但 mtime 變了（例如 touch）：更新指紋，仍不必讀內容
    entry.fingerprint = currentFp;
    return [];
  }

  // 同樣道理：offset 只能照 readNewBytes 實際回報的 bytesRead 推進，不是預先算好的 size - offset。
  const { content, bytesRead } = readNewBytes(transcriptPath, entry.tailState.offset, size);
  const result = runOnce(entry.tailState, entry.stats, entry.subagents, content, bytesRead, agent);
  // 讀取失敗（bytesRead=0 但檔案比 offset 長）時不更新指紋，否則下次會被 warm skip 掉、永遠讀不到。
  const fingerprint =
    bytesRead > 0 ? fingerprintOf(transcriptPath) : entry.fingerprint;
  sessions.set(sessionId, {
    tailState: result.tailState,
    stats: result.stats,
    subagents: result.subagents,
    fingerprint,
  });
  return result.advice;
}

export function forget(sessionId: string): void {
  sessions.delete(sessionId);
}

export function peek(sessionId: string): SessionUsageStats | undefined {
  return sessions.get(sessionId)?.stats;
}

export function peekSubagents(sessionId: string): SubagentsState | undefined {
  return sessions.get(sessionId)?.subagents;
}
