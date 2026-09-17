export const MIN_SPLIT_COLUMNS = 120;
export const SPLIT_TASK_ROWS = 5;

export const SPLIT_TOO_NARROW_NOTICE = `終端寬度不足（需 ≥ ${MIN_SPLIT_COLUMNS}）無法分割`;

export type SplitFocus = "left" | "right";

export function canEnterSplit(columns: number): boolean {
  return columns >= MIN_SPLIT_COLUMNS;
}

export function otherFocus(focus: SplitFocus): SplitFocus {
  return focus === "left" ? "right" : "left";
}

export function focusedSessionId(leftId: string, rightId: string, focus: SplitFocus): string {
  return focus === "left" ? leftId : rightId;
}

export function canPickSplitPartner(candidateId: string, leftId: string): boolean {
  return candidateId !== leftId;
}
