import type { Advice } from "./types.js";

export function attachHeavyBaselineHeat(advice: Advice[], heatLines: string[]): Advice[] {
  if (heatLines.length === 0) return advice;
  return advice.map((item) =>
    item.kind === "heavy-baseline" ? { ...item, detailLines: heatLines } : item,
  );
}
