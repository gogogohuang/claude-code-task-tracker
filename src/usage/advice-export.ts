import { shortSessionId } from "../session-preference.js";
import { adviceOverviewLine, groupAdvice } from "./advice-groups.js";
import { elapsedMinutes, formatElapsedMinutes } from "./detect.js";
import { formatTokenCount } from "../usage-overview.js";
import { Advice, SessionUsageStats } from "./types.js";

function mergeSuffix(count: number, estTokensSum: number | undefined): string {
  if (count <= 1) return "";
  const tokenPart = estTokensSum !== undefined ? `，累積約 ${formatTokenCount(estTokensSum)} token` : "";
  return `（×${count} 次${tokenPart}）`;
}

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

  const groups = groupAdvice(advice);
  if (groups.length === 0) {
    lines.push("目前沒有用量建議。");
    return lines.join("\n");
  }

  lines.push(adviceOverviewLine(groups));
  lines.push("");

  for (const group of groups) {
    lines.push(`## ${group.kind} · ${group.totalCount} 則`);
    for (const row of group.rows) {
      const marker = row.severity === "critical" ? "✗" : "⚠";
      lines.push(`${marker} ${row.summary}${mergeSuffix(row.count, row.estTokensSum)}`);
      lines.push(`  → ${row.action}`);
      for (const detail of row.detailLines ?? []) {
        lines.push(`  · ${detail}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
