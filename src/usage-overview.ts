import { TAB_LABELS, type Agent } from "./agent.js";

export const SHARE_BAR_WIDTH = 12;

export interface UsageOverviewInput {
  sessionId: string;
  /** 畫面上的名稱，例如「專案名 · 短 session id」。 */
  label: string;
  agent: Agent;
  /** 累計新增工作量 token；undefined = 還沒有用量資料。 */
  workTokens: number | undefined;
}

export interface UsageOverviewRow extends UsageOverviewInput {
  /** 占「有資料的 session 總和」的百分比（四捨五入到整數）；無資料為 undefined。 */
  sharePct: number | undefined;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** 999 → "999"、12_345 → "12.3K"、2_345_678 → "2.3M"；四捨五入後不足 1M 會進位成 "1M"，不會出現 "1000K"。 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(Math.max(0, Math.round(tokens)));
  const thousands = Math.round(tokens / 100) / 10;
  if (thousands < 1_000) return `${trimZero(thousands)}K`;
  return `${trimZero(Math.round(tokens / 100_000) / 10)}M`;
}

export function formatShareBar(sharePct: number, width: number = SHARE_BAR_WIDTH): string {
  const filled = Math.min(width, Math.max(0, Math.round((sharePct / 100) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

/** 有資料者依 workTokens 由大到小（同值依 sessionId），無資料者排最後；回傳新陣列，不改動輸入。 */
export function buildUsageOverview(inputs: readonly UsageOverviewInput[]): UsageOverviewRow[] {
  const total = inputs.reduce((sum, item) => sum + (item.workTokens ?? 0), 0);
  const rows: UsageOverviewRow[] = inputs.map((item) => ({
    ...item,
    sharePct:
      item.workTokens === undefined ? undefined : total === 0 ? 0 : Math.round((item.workTokens / total) * 100),
  }));
  return rows.sort((left, right) => {
    if (left.workTokens === undefined && right.workTokens === undefined) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    if (left.workTokens === undefined) return 1;
    if (right.workTokens === undefined) return -1;
    if (right.workTokens !== left.workTokens) return right.workTokens - left.workTokens;
    return left.sessionId.localeCompare(right.sessionId);
  });
}

export function formatUsageOverviewLine(row: UsageOverviewRow): string {
  const source = `[${TAB_LABELS[row.agent]}]`;
  if (row.workTokens === undefined || row.sharePct === undefined) return `${source} ${row.label}  —`;
  return `${source} ${row.label}  ${formatTokenCount(row.workTokens)}  ${row.sharePct}%  ${formatShareBar(row.sharePct)}`;
}

export function summarizeUsageOverview(rows: readonly UsageOverviewRow[]): {
  sessions: number;
  measured: number;
  totalTokens: number;
} {
  let measured = 0;
  let totalTokens = 0;
  for (const row of rows) {
    if (row.workTokens === undefined) continue;
    measured += 1;
    totalTokens += row.workTokens;
  }
  return { sessions: rows.length, measured, totalTokens };
}
