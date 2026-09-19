import { TAB_AGENTS, TAB_LABELS, type TabAgent } from "./agent.js";
import { filterSessionsByAgent, presenceForHint, type SessionHint } from "./session-preference.js";

export interface TabSummary {
  agent: TabAgent;
  label: string;
  count: number;
  /** 該來源有 session 正在等使用者（提示色）。SessionHint 沒有活動時間，卡住偵測不在分頁上做。 */
  attention: boolean;
  supported: boolean;
}

export function nextTabAgent(current: TabAgent, direction: 1 | -1 = 1): TabAgent {
  const index = TAB_AGENTS.indexOf(current);
  return TAB_AGENTS[(index + direction + TAB_AGENTS.length) % TAB_AGENTS.length];
}

export function summarizeTabs(hints: SessionHint[], now: number = Date.now()): TabSummary[] {
  return TAB_AGENTS.map((agent) => {
    const sessions = filterSessionsByAgent(hints, agent);
    return {
      agent,
      label: TAB_LABELS[agent],
      count: sessions.length,
      attention: sessions.some((session) => presenceForHint(session, now) === "waiting"),
      supported: agent !== "cursor",
    };
  });
}

export function formatTabLabel(tab: TabSummary): string {
  const badge = tab.supported ? String(tab.count) : "–";
  return `${tab.label} ${badge}${tab.attention ? " !" : ""}`;
}

/** 分頁列只在 session 列表畫面顯示，所以也只在那裡響應切換鍵。 */
export function canSwitchTab(state: { view: string; hasSelectedSession: boolean; pickingSplitPartner: boolean }): boolean {
  return state.view === "main" && !state.hasSelectedSession && !state.pickingSplitPartner;
}
