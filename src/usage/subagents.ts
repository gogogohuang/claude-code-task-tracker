import { ParsedEvent } from "./types.js";

export type AgentDispatchStatus = "running" | "done";

export interface AgentDispatch {
  toolUseId: string;
  subagentType?: string;
  description?: string;
  /** 只有派發時明確 override 模型才會有值；沒 override 就沒有這個欄位，不臆測預設值。 */
  model?: string;
  status: AgentDispatchStatus;
  startedAt?: string;
  endedAt?: string;
}

/**
 * v1：只有「Agent 派發清單」＋「全域最新 sidechain 活動句」，不做逐一 branch 的精準歸屬——
 * 平行派發時 isSidechain 無法從 transcript 精準對回是哪一個 Agent，這是已知限制。
 */
export interface SubagentsState {
  dispatches: AgentDispatch[];
  latestSidechainActivity?: { text: string; at?: string };
}

export function createSubagentsState(): SubagentsState {
  return { dispatches: [] };
}

function sidechainActivityText(event: ParsedEvent): string | undefined {
  if (!event.toolUseName) return undefined;
  return event.toolUsePath ? `${event.toolUseName} ${event.toolUsePath}` : event.toolUseName;
}

export function applySubagentEvents(prev: SubagentsState, events: ParsedEvent[]): SubagentsState {
  let state = prev;

  for (const event of events) {
    if (event.isSidechain) {
      const text = sidechainActivityText(event);
      if (text) state = { ...state, latestSidechainActivity: { text, at: event.timestamp } };
      continue;
    }

    if (event.agentDispatch) {
      const { toolUseId, subagentType, description, model } = event.agentDispatch;
      const dispatch: AgentDispatch = {
        toolUseId,
        subagentType,
        description,
        ...(model !== undefined ? { model } : {}),
        status: "running",
        startedAt: event.timestamp,
        endedAt: undefined,
      };
      state = { ...state, dispatches: [...state.dispatches, dispatch] };
      continue;
    }

    if (event.toolResultChars?.toolName === "Agent" && event.toolResultChars.toolUseId) {
      const id = event.toolResultChars.toolUseId;
      state = {
        ...state,
        dispatches: state.dispatches.map((d) =>
          d.toolUseId === id ? { ...d, status: "done", endedAt: event.timestamp } : d,
        ),
      };
    }
  }

  return state;
}

export function dispatchLabel(dispatch: AgentDispatch): string {
  const type = dispatch.subagentType ?? "agent";
  const desc = dispatch.description ?? dispatch.toolUseId;
  const base = `${type} · ${desc}`;
  return dispatch.model ? `${base} · ${dispatch.model}` : base;
}
