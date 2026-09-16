import { TaskState } from "./schema.js";
import { readSessionCacheRaw, serializeSessionCache } from "./show-session-cache.js";

export function cachePanelLines(input: {
  filePath: string;
  state: TaskState | null;
  rawFallback?: string;
}): string[] {
  const header = [`# ${input.filePath}`, ""];
  if (input.state) {
    return [...header, ...serializeSessionCache(input.state).split("\n")];
  }
  if (input.rawFallback !== undefined) {
    return [
      ...header,
      ...input.rawFallback.trimEnd().split("\n"),
      "",
      "（schema 解析失敗，顯示原始內容）",
    ];
  }
  return [...header, "（暫存不存在或無法讀取）"];
}

export function cachePanelLinesForSession(sessionId: string, filePath: string, state: TaskState | null): string[] {
  const raw = state ? undefined : readSessionCacheRaw(sessionId);
  return cachePanelLines({ filePath, state, rawFallback: raw });
}
