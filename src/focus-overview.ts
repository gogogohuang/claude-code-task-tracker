import type { Agent } from "./agent.js";
import { presenceColor, presenceLabelPrefix, type SessionPresence } from "./session-presence.js";
import type { Advice } from "./usage/types.js";

export interface FocusInput {
  sessionId: string;
  /** 畫面上的名稱，例如「專案名 · 短 session id」。 */
  label: string;
  agent: Agent;
  presence: SessionPresence;
  /** 該 session 目前最嚴重的一筆建議（已依嚴重度排序後的第一筆）；沒有就是目前沒有 advice。 */
  advice?: Advice;
}

/** 等你 < critical advice < warn advice < 忙碌無 advice；presence 是 idle 且沒有 advice 的不會進來排序（已被濾掉）。 */
function focusRank(row: FocusInput): number {
  if (row.presence === "waiting") return 0;
  if (row.advice?.severity === "critical") return 1;
  if (row.advice?.severity === "warn") return 2;
  return 3;
}

/** 濾掉 presence 是 idle 且沒有 advice 的 session（沒事不列），依 focusRank 排序；回傳新陣列，不改動輸入。 */
export function buildFocusOverview(inputs: readonly FocusInput[]): FocusInput[] {
  return inputs
    .filter((row) => row.presence !== "idle" || row.advice !== undefined)
    .slice()
    .sort((left, right) => focusRank(left) - focusRank(right) || left.sessionId.localeCompare(right.sessionId));
}

export function formatFocusLine(row: FocusInput): string {
  const prefix = presenceLabelPrefix(row.presence);
  if (row.advice) {
    const icon = row.advice.severity === "critical" ? "✗" : "⚠";
    return `${prefix}${row.label}  ${icon} ${row.advice.summary} → ${row.advice.action}`;
  }
  const note = row.presence === "waiting" ? "等你" : "進行中";
  return `${prefix}${row.label}  ${note}`;
}

export function focusLineColor(row: FocusInput): "red" | "yellow" | "green" {
  if (row.advice) return row.advice.severity === "critical" ? "red" : "yellow";
  return presenceColor(row.presence);
}
