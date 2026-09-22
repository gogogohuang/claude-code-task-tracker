import type { ToolCallLogEntry, ToolInventory } from "./tool-inventory.js";
import type { Agent } from "../agent.js";

export interface ParsedUsage {
  cacheCreation: number;
  cacheRead: number;
  output: number;
  input: number;
  /** Codex 才有：這次呼叫時模型的 context 視窗大小（rollout 的 model_context_window）。 */
  contextWindow?: number;
}

export interface ToolResultChars {
  toolName: string | undefined;
  chars: number;
  path?: string;
  toolUseId?: string;
  /** transcript 的 tool_result.is_error；工具執行失敗時為 true。 */
  isError?: boolean;
}

export interface ToolUseRef {
  name: string;
  path?: string;
}

/** Agent tool_use 事件帶出的派發資訊（供 sub-agent 追蹤使用）。 */
export interface AgentDispatchInfo {
  toolUseId: string;
  subagentType?: string;
  description?: string;
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
  toolUseId?: string;
  /** 這次呼叫做了什麼的一句話（與 hook 活動句同一套，例如「已執行 npm test」） */
  toolUseSummary?: string;
  /** 只在 tool_use 是 Agent 時才有值 */
  agentDispatch?: AgentDispatchInfo;
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
  /** 主線工具呼叫的時序紀錄（依呼叫順序），供 history 面板回放整個 session。 */
  toolCallLog?: ToolCallLogEntry[];
  /** 只有 Codex 才會設定；detect 依它切換建議文案。缺省視為 claude。 */
  agent?: Agent;
  /** 最近一次呼叫的模型 context 視窗（Codex 由 rollout 帶入；缺省時量表用 Claude 的 1,000,000）。 */
  lastContextWindow?: number;
  /**
   * 累計「新增工作量」token：input + cacheCreation + output，不含 cache 讀取。
   * 只計主線、已通過 messageId 去重的 usage 事件（子 agent 的 sidechain 事件被 accumulate 略過，不計入）。
   */
  workTokensTotal?: number;
}

export function createSessionUsageStats(sessionId: string, agent: Agent = "claude"): SessionUsageStats {
  return {
    sessionId,
    mainThreadMsgCount: 0,
    sessionStartedAt: undefined,
    lastMsgAt: undefined,
    cacheCreationTotal: 0,
    cacheCreationRollingAvg: 0,
    recentMessageIds: [],
    readPathCounts: {},
    ...(agent === "codex" ? { agent } : {}),
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

export type AdviceSeverity = "warn" | "critical";

export interface Advice {
  sessionId: string;
  kind: AdviceKind;
  at: string;
  severity: AdviceSeverity;
  /** 發生了什麼，含數字。 */
  summary: string;
  /** 建議怎麼做。 */
  action: string;
  detailLines?: string[];
}
