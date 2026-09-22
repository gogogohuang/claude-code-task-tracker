import { statSync } from "node:fs";

/** transcript 檔指紋：mtime + size 都沒變 → warm，不必再進 refresh 讀檔。 */
export interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

export function fingerprintOf(path: string): FileFingerprint | undefined {
  try {
    const stat = statSync(path);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

export function isWarmFingerprint(
  cached: FileFingerprint | undefined,
  current: FileFingerprint,
): boolean {
  return (
    cached !== undefined &&
    cached.mtimeMs === current.mtimeMs &&
    cached.size === current.size
  );
}
