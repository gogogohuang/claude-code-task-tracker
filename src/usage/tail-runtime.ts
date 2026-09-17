import { closeSync, openSync, readSync, statSync } from "node:fs";
import { accumulate } from "./accumulate.js";
import { detect } from "./detect.js";
import { applySubagentEvents, createSubagentsState, SubagentsState } from "./subagents.js";
import { createTailState, parseNewContent } from "./tail-transcript.js";
import { Advice, createSessionUsageStats, SessionUsageStats, TailState } from "./types.js";

interface RuntimeEntry {
  tailState: TailState;
  stats: SessionUsageStats;
  subagents: SubagentsState;
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
): { tailState: TailState; stats: SessionUsageStats; subagents: SubagentsState; advice: Advice[] } {
  const parsed = parseNewContent(content, prevTailState, bytesRead);
  const { next, steps } = accumulate(prevStats, parsed.events);
  const advice = detect(prevStats, next, steps);
  const subagents = applySubagentEvents(prevSubagents, parsed.events);
  return { tailState: parsed.state, stats: next, subagents, advice };
}

export function prime(sessionId: string, transcriptPath: string): { stats: SessionUsageStats; advice: Advice[] } {
  const stats0 = createSessionUsageStats(sessionId);
  const subagents0 = createSubagentsState();
  const size = fileSize(transcriptPath);
  if (size === undefined) {
    sessions.set(sessionId, { tailState: createTailState(), stats: stats0, subagents: subagents0 });
    return { stats: stats0, advice: [] };
  }
  // offset 要錨在「這次真正讀到多少 bytes」，不能用 size 這個意圖值 —— 讀取失敗時
  // readNewBytes 會回傳 bytesRead:0，offset 就該原地不動，等下一次再重試。
  const { content, bytesRead } = readNewBytes(transcriptPath, 0, size);
  const result = runOnce(createTailState(), stats0, subagents0, content, bytesRead);
  sessions.set(sessionId, { tailState: result.tailState, stats: result.stats, subagents: result.subagents });
  return { stats: result.stats, advice: result.advice };
}

export function refresh(sessionId: string, transcriptPath: string): Advice[] {
  const entry = sessions.get(sessionId);
  if (!entry) return prime(sessionId, transcriptPath).advice;

  const size = fileSize(transcriptPath);
  if (size === undefined) return [];
  if (size < entry.tailState.offset) return prime(sessionId, transcriptPath).advice; // 檔案被截斷/換新，視同重新開始
  if (size === entry.tailState.offset) return [];

  // 同樣道理：offset 只能照 readNewBytes 實際回報的 bytesRead 推進，不是預先算好的 size - offset。
  const { content, bytesRead } = readNewBytes(transcriptPath, entry.tailState.offset, size);
  const result = runOnce(entry.tailState, entry.stats, entry.subagents, content, bytesRead);
  sessions.set(sessionId, { tailState: result.tailState, stats: result.stats, subagents: result.subagents });
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
