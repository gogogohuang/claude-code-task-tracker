import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const DELETE_SESSION_CONFIRM_NOTICE = "再按 d 刪除這個 session（按 b 取消）";

export function shouldHandleDeleteKey(
  view: "main" | "advice",
  selectedSessionId: string | undefined,
): boolean {
  return view === "main" && selectedSessionId !== undefined;
}

export function armOrConfirmDelete(
  pendingSessionId: string | undefined,
  selectedSessionId: string,
): "arm" | "confirm" {
  return pendingSessionId === selectedSessionId ? "confirm" : "arm";
}

export function deleteSessionState(sessionId: string, stateDir: string): boolean {
  const path = join(stateDir, `${sessionId}.json`);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
