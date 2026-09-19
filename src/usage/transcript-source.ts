import { agentOf, type Agent } from "../agent.js";
import type { TaskState } from "../schema.js";
import { resolveTranscriptPath } from "../workflow/paths.js";

/**
 * 由狀態檔決定用量分析要 tail 哪個檔、用哪種解析器。
 * Claude：claudeSessionDir 推出 transcript；Codex：hook 寫下的 transcriptPath（rollout 檔）。
 * 任一來源缺路徑就回 undefined（尚未納入分析）。
 */
export function transcriptSource(
  state: TaskState | null | undefined,
): { agent: Agent; path: string } | undefined {
  if (!state) return undefined;
  const agent = agentOf(state);
  if (agent === "codex") {
    return state.transcriptPath ? { agent, path: state.transcriptPath } : undefined;
  }
  return state.claudeSessionDir
    ? { agent, path: resolveTranscriptPath(state.claudeSessionDir, state.sessionId) }
    : undefined;
}
