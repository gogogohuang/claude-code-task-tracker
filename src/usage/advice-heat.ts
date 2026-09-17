import type { Advice } from "./types.js";

const EMPTY_HEAT_FALLBACK = [
  "（此目錄找不到明顯大檔；請在該 session 的專案目錄執行 task-tracker inspect）",
];

export function attachHeavyBaselineHeat(advice: Advice[], heatLines: string[]): Advice[] {
  const detailLines = heatLines.length > 0 ? heatLines : EMPTY_HEAT_FALLBACK;
  return advice.map((item) =>
    item.kind === "heavy-baseline" ? { ...item, detailLines } : item,
  );
}
