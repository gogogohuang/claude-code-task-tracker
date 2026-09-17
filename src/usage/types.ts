import type { ToolInventory } from "./tool-inventory.js";

export interface ParsedUsage {
  cacheCreation: number;
  cacheRead: number;
  output: number;
  input: number;
}

export interface ToolResultChars {
  toolName: string | undefined;
  chars: number;
  path?: string;
}

export interface ToolUseRef {
  name: string;
  path?: string;
}

/** 一行 transcript JSONL 解析出來的事件。assistant 行帶 usage；user 行裡的 tool_result 帶 toolResultChars。 */
export interface ParsedEvent {
  messageId: string | undefined;
  isSidechain: boolean;
  timestamp: string | undefined;
  usage: ParsedUsage | undefined;
  toolResultChars: ToolResultChars | undefined;
  toolUseName?: string;
  /** tool_use 的檔案路徑（Read 等） */
  toolUsePath?: string;
  title?: string;
  userText?: string;
}

export interface TailState {
  offset: number;
  toolUseNameById: Map<string, ToolUseRef>;
  danglingLine: string;
}

export interface SessionUsageStats {
  sessionId: string;
  mainThreadMsgCount: number;
  sessionStartedAt: string | undefined;
  lastMsgAt: string | undefined;
  cacheCreationTotal: number;
  cacheCreationRollingAvg: number;
  recentMessageIds: string[];
  title?: string;
  firstPrompt?: string;
  lastOccupiedTokens?: number;
  lastCacheRead?: number;
  lastCacheCreation?: number;
  lastInput?: number;
  toolInventory?: ToolInventory;
  /** 主線 Read 各 path 次數（供 repeated-read） */
  readPathCounts?: Record<string, number>;
}

export function createSessionUsageStats(sessionId: string): SessionUsageStats {
  return {
    sessionId,
    mainThreadMsgCount: 0,
    sessionStartedAt: undefined,
    lastMsgAt: undefined,
    cacheCreationTotal: 0,
    cacheCreationRollingAvg: 0,
    recentMessageIds: [],
    readPathCounts: {},
  };
}

/** accumulate() 逐一套用事件時，每個「有效」事件前後的狀態快照，供 detect() 逐事件判斷門檻。 */
export interface AccumulateStep {
  event: ParsedEvent;
  statsBefore: SessionUsageStats;
  statsAfter: SessionUsageStats;
}

export type AdviceKind =
  | "long-session"
  | "cache-spike"
  | "fat-tool-result"
  | "heavy-baseline"
  | "repeated-read";

export interface Advice {
  sessionId: string;
  kind: AdviceKind;
  at: string;
  message: string;
  detailLines?: string[];
}
