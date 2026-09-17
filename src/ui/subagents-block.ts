import type { SubagentsState } from "../usage/subagents.js";

/** SubagentsBlock 用 Box marginBottom={1} 包起來，算可視列數時要把這一行空白也算進去。 */
export function subagentBlockRows(subagents: SubagentsState | undefined): number {
  if (!subagents || subagents.dispatches.length === 0) return 0;
  return 2 + subagents.dispatches.length + (subagents.latestSidechainActivity ? 1 : 0);
}
