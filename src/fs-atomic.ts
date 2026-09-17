import { renameSync, writeFileSync } from "node:fs";

/** write-then-rename，避免讀者讀到寫一半、或 crash 中斷寫入而毀損既有檔案。 */
export function writeFileAtomic(path: string, content: string): void {
  const tmpPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, path);
}
