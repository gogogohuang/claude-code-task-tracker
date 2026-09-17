import { existsSync, statSync } from "node:fs";
import type { InspectEntry, InspectSection } from "./types.js";

const SECTION_ORDER: InspectSection[] = ["launch", "onDemand", "outOfSession"];

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachByteSizes(entries: InspectEntry[]): InspectEntry[] {
  return entries.map((entry) => {
    if (entry.status === "missing") return entry;
    if (!existsSync(entry.absolutePath)) return entry;
    try {
      return { ...entry, byteSize: statSync(entry.absolutePath).size };
    } catch {
      return entry;
    }
  });
}

export function sortEntriesByHeat(entries: InspectEntry[]): InspectEntry[] {
  const result: InspectEntry[] = [];
  for (const section of SECTION_ORDER) {
    const group = entries.filter((e) => e.section === section);
    group.sort((a, b) => {
      const aSize = a.byteSize;
      const bSize = b.byteSize;
      if (aSize === undefined && bSize === undefined) return 0;
      if (aSize === undefined) return 1;
      if (bSize === undefined) return -1;
      return bSize - aSize;
    });
    result.push(...group);
  }
  return result;
}

export function heatSummaryLines(entries: InspectEntry[], topN: number = 5): string[] {
  // 開場偏重常來自 skills／workflows（inspect 歸 onDemand），不只 launch。
  const ranked = entries
    .filter(
      (e) =>
        (e.section === "launch" || e.section === "onDemand") && e.byteSize !== undefined,
    )
    .sort((a, b) => (b.byteSize ?? 0) - (a.byteSize ?? 0))
    .slice(0, topN);
  return ranked.map((e) => `${e.label} · ${formatByteSize(e.byteSize!)}`);
}
