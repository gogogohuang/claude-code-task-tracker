import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const DELETE_SESSION_CONFIRM_NOTICE = "再按 d 刪除這個 session（按 b 取消）";
export const DELETE_SESSION_RUNNING_NOTICE = "這個 session 正在執行中，無法刪除";

export function shouldHandleDeleteKey(
  view: "main" | "advice" | "purge",
  selectedSessionId: string | undefined,
): boolean {
  return view === "main" && selectedSessionId !== undefined;
}

export function isSessionBusy(activity: { phase: string } | undefined | null): boolean {
  return activity?.phase === "running";
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
