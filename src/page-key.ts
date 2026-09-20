import type { TabAgent } from "./agent.js";
import type { WatchView } from "./delete-session.js";

/** watch 主畫面「現在在哪一頁」由這些維度決定；任何一個變了就算換頁。 */
export interface PageIdentity {
  view: WatchView;
  activeAgent: TabAgent;
  selectedSessionId: string | undefined;
  projectKey: string | undefined;
  pickingSplitPartner: boolean;
}

/** 換頁時整棵子樹要重掛、畫面要從頂端重畫；同一頁內的狀態更新則維持同一個 key。 */
export function pageKeyOf(page: PageIdentity): string {
  return JSON.stringify([
    page.view,
    page.activeAgent,
    page.selectedSessionId ?? null,
    page.projectKey ?? null,
    page.pickingSplitPartner,
  ]);
}

/** 清整個可視畫面並把游標移回左上角（不清 scrollback）。 */
export const CLEAR_SCREEN_AND_HOME = "\x1b[2J\x1b[H";
