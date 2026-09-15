import { closeSync, openSync, readSync, statSync } from "node:fs";
import { accumulate } from "./accumulate.js";
import { detect } from "./detect.js";
import { createTailState, parseNewContent } from "./tail-transcript.js";
import { Advice, createSessionUsageStats, SessionUsageStats, TailState } from "./types.js";

interface RuntimeEntry {
  tailState: TailState;
  stats: SessionUsageStats;
}

const sessions = new Map<string, RuntimeEntry>();

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function readNewBytes(path: string, offset: number, size: number): string {
  if (size <= offset) return "";
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return "";
  }
  try {
    readSync(fd, buffer, 0, length, offset);
  } catch {
    return "";
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf-8");
}

function runOnce(
  prevTailState: TailState,
  prevStats: SessionUsageStats,
  content: string,
  bytesRead: number,
): { tailState: TailState; stats: SessionUsageStats; advice: Advice[] } {
  const parsed = parseNewContent(content, prevTailState, bytesRead);
  const { next, steps } = accumulate(prevStats, parsed.events);
  const advice = detect(prevStats, next, steps);
  return { tailState: parsed.state, stats: next, advice };
}

export function prime(sessionId: string, transcriptPath: string): { stats: SessionUsageStats; advice: Advice[] } {
  const stats0 = createSessionUsageStats(sessionId);
  const size = fileSize(transcriptPath);
  if (size === undefined) {
    sessions.set(sessionId, { tailState: createTailState(), stats: stats0 });
    return { stats: stats0, advice: [] };
  }
  // 讀取永遠是「從 0 讀到目前檔案大小」，所以這次真正讀到的位元組數就是 size 本身；
  // 不管 decode 出來的字串長什麼樣子，下一次讀取的 offset 都必須錨在這個磁碟真實位置上。
  const content = readNewBytes(transcriptPath, 0, size);
  const result = runOnce(createTailState(), stats0, content, size);
  sessions.set(sessionId, { tailState: result.tailState, stats: result.stats });
  return { stats: result.stats, advice: result.advice };
}

export function refresh(sessionId: string, transcriptPath: string): Advice[] {
  const entry = sessions.get(sessionId);
  if (!entry) return prime(sessionId, transcriptPath).advice;

  const size = fileSize(transcriptPath);
  if (size === undefined) return [];
  if (size < entry.tailState.offset) return prime(sessionId, transcriptPath).advice; // 檔案被截斷/換新，視同重新開始
  if (size === entry.tailState.offset) return [];

  // 同樣道理：讀取是從目前的 offset 讀到現在的 size，真正讀到的位元組數是 size - offset。
  const bytesRead = size - entry.tailState.offset;
  const content = readNewBytes(transcriptPath, entry.tailState.offset, size);
  const result = runOnce(entry.tailState, entry.stats, content, bytesRead);
  sessions.set(sessionId, { tailState: result.tailState, stats: result.stats });
  return result.advice;
}

export function forget(sessionId: string): void {
  sessions.delete(sessionId);
}
