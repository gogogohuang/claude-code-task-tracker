import { Preview } from "./preview.js";

export function previewDisplayLines(preview: Preview): string[] {
  if (!preview.text) return [preview.notice ?? ""];
  const lines = preview.text.split("\n");
  if (preview.loadBoundaryLine === undefined) return lines;
  return [
    ...lines.slice(0, preview.loadBoundaryLine),
    "──── 啟動時不載入 ────",
    ...lines.slice(preview.loadBoundaryLine),
  ];
}

export function previewLineCount(preview: Preview): number {
  return previewDisplayLines(preview).length;
}
