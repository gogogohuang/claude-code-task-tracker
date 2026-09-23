import { Advice, AdviceKind, AdviceSeverity } from "./types.js";

const SEVERITY_RANK: Record<Advice["severity"], number> = { critical: 0, warn: 1 };

/** critical 排在 warn 前面，同 severity 依時間新到舊。 */
export function adviceForSession(advice: readonly Advice[], sessionId: string | undefined): Advice[] {
  if (sessionId === undefined) return [];
  return advice
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => {
      const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDiff !== 0) return severityDiff;
      return right.at.localeCompare(left.at);
    });
}

/** AdvicePanel／複製輸出用的合併列：同 kind+target 的多筆會併成一列，count 是原始筆數。 */
export interface AdviceRow extends Advice {
  count: number;
  /** 併入的筆裡有 estTokens 才會加總，全都沒有就是 undefined。 */
  estTokensSum?: number;
}

export interface AdviceGroup {
  kind: AdviceKind;
  /** 這個 kind 併之前的原始筆數，供總覽列使用。 */
  totalCount: number;
  rows: AdviceRow[];
}

function bySeverityThenRecency(left: AdviceRow, right: AdviceRow): number {
  const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDiff !== 0) return severityDiff;
  return right.at.localeCompare(left.at);
}

function toRow(items: Advice[]): AdviceRow {
  const latest = [...items].sort((left, right) => right.at.localeCompare(left.at))[0];
  const severity: AdviceSeverity = items.some((item) => item.severity === "critical") ? "critical" : "warn";
  const hasEstTokens = items.some((item) => item.estTokens !== undefined);
  const estTokensSum = hasEstTokens ? items.reduce((sum, item) => sum + (item.estTokens ?? 0), 0) : undefined;
  return { ...latest, severity, count: items.length, estTokensSum };
}

/** 同 kind 內，target 相同的多筆併成一列；target 未設的（如 long-session）各自成一列，永不併。 */
function mergeByTarget(items: Advice[]): AdviceRow[] {
  const byTarget = new Map<string, Advice[]>();
  const singles: Advice[] = [];
  for (const item of items) {
    if (item.target === undefined) {
      singles.push(item);
      continue;
    }
    const list = byTarget.get(item.target) ?? [];
    list.push(item);
    byTarget.set(item.target, list);
  }
  const rows = [...byTarget.values()].map(toRow);
  rows.push(...singles.map((item) => toRow([item])));
  return rows.sort(bySeverityThenRecency);
}

function groupSeverityRank(rows: AdviceRow[]): number {
  return rows.some((row) => row.severity === "critical") ? 0 : 1;
}

function groupLatestAt(rows: AdviceRow[]): string {
  return rows.reduce((latest, row) => (row.at > latest ? row.at : latest), "");
}

/** 依 kind 分組、組內依 target 合併，供 AdvicePanel 分組顯示與複製輸出共用。組排序：含 critical 的 kind 優先，同層依最新時間。 */
export function groupAdvice(advice: readonly Advice[]): AdviceGroup[] {
  const byKind = new Map<AdviceKind, Advice[]>();
  for (const item of advice) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }
  const groups: AdviceGroup[] = [...byKind.entries()].map(([kind, items]) => ({
    kind,
    totalCount: items.length,
    rows: mergeByTarget(items),
  }));
  return groups.sort((left, right) => {
    const rankDiff = groupSeverityRank(left.rows) - groupSeverityRank(right.rows);
    if (rankDiff !== 0) return rankDiff;
    return groupLatestAt(right.rows).localeCompare(groupLatestAt(left.rows));
  });
}

/** 面板頂部總覽列，例如「共 6 則：fat-tool-result 3 · cache-spike 2 · long-session 1」。 */
export function adviceOverviewLine(groups: readonly AdviceGroup[]): string {
  const total = groups.reduce((sum, group) => sum + group.totalCount, 0);
  const parts = groups.map((group) => `${group.kind} ${group.totalCount}`);
  return `共 ${total} 則：${parts.join(" · ")}`;
}
