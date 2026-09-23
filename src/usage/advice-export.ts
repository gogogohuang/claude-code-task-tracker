import { shortSessionId } from "../session-preference.js";
import { formatAdviceGroupsLines } from "./advice-groups.js";
import { elapsedMinutes, formatElapsedMinutes } from "./detect.js";
import { formatTokenCount } from "../usage-overview.js";
import { Advice, SessionUsageStats } from "./types.js";

/** 貼給其他 AI 分析用的純文字：session 基本資訊 + 依 kind 分組合併後的建議清單。 */
export function formatAdviceForClipboard(stats: SessionUsageStats, advice: readonly Advice[]): string {
  const lines: string[] = [];
  lines.push(`用量建議 · ${shortSessionId(stats.sessionId)}（session ${stats.sessionId}）`);
  lines.push(`agent：${stats.agent ?? "claude"}`);
  lines.push(`已進行 ${formatElapsedMinutes(elapsedMinutes(stats))}，共 ${stats.mainThreadMsgCount.toLocaleString("en-US")} 則訊息`);
  if (stats.workTokensTotal !== undefined) {
    lines.push(`累積新增工作量約 ${formatTokenCount(stats.workTokensTotal)} token`);
  }
  lines.push("");

  const groupLines = formatAdviceGroupsLines(advice);
  if (groupLines.length === 0) {
    lines.push("目前沒有用量建議。");
    return lines.join("\n");
  }
  lines.push(...groupLines);

  return lines.join("\n").trimEnd();
}
