import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { InspectEntry, InspectStatus } from "./types.js";

const FOUR_MIB = 4 * 1024 * 1024;
const MEMORY_BYTES = 25 * 1024;
const MEMORY_LINES = 200;

export interface Preview {
  text?: string;
  loadBoundaryLine?: number;
  notice?: string;
}

const NOTICE: Partial<Record<InspectStatus, string>> = {
  missing: "未找到",
  external: "外部，可能尚未核准",
  excluded: "已排除",
  "skipped-too-large": "Claude 會略過",
  disabled: "未載入",
};

export function memoryLoadBoundaryLine(text: string): number | undefined {
  const lines = text.split("\n");
  let bytes = 0;
  const limit = Math.min(lines.length, MEMORY_LINES);
  for (let index = 0; index < limit; index += 1) {
    const lineBytes = Buffer.byteLength(lines[index], "utf8");
    const separator = index < lines.length - 1 ? 1 : 0;
    if (bytes + lineBytes + separator > MEMORY_BYTES) return index;
    bytes += lineBytes + separator;
  }
  return lines.length > MEMORY_LINES ? MEMORY_LINES : undefined;
}

function isClaudeMd(path: string): boolean {
  const name = basename(path);
  return name === "CLAUDE.md" || name === "CLAUDE.local.md";
}

export function readPreview(entry: InspectEntry): Preview {
  if (entry.section === "onDemand") return { notice: "按需載入，不預覽內容" };
  if (entry.section === "outOfSession") return { notice: "此目錄不會載入，不預覽內容" };
  const notice = NOTICE[entry.status];
  if (notice) return { notice };
  try {
    if (isClaudeMd(entry.absolutePath) && statSync(entry.absolutePath).size > FOUR_MIB) {
      return { notice: "Claude 會略過" };
    }
    const text = readFileSync(entry.absolutePath, "utf8");
    if (basename(entry.absolutePath) !== "MEMORY.md") return { text };
    const loadBoundaryLine = memoryLoadBoundaryLine(text);
    return loadBoundaryLine === undefined ? { text } : { text, loadBoundaryLine };
  } catch {
    return { notice: "無法讀取" };
  }
}
