import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isActivityStuck } from "./activity-stuck.js";

export const DELETE_SESSION_CONFIRM_NOTICE =
  "再按 d 清除此 session 暫存（不影響 Claude context；按 b 取消）";
export const DELETE_SESSION_RUNNING_NOTICE = "這個 session 正在執行中，無法清除暫存";
export const DELETE_SESSION_STUCK_CONFIRM_NOTICE =
  "此 session 可能卡住，再按 d 強制清除暫存（不影響 Claude context；按 b 取消）";

export type WatchView = "main" | "advice" | "cache" | "tools" | "history" | "split" | "usage" | "focus";

export function shouldHandleDeleteKey(view: WatchView, selectedSessionId: string | undefined): boolean {
  return (view === "main" || view === "split") && selectedSessionId !== undefined;
}

export function isSessionBusy(activity: { phase: string } | undefined | null): boolean {
  return activity?.phase === "running";
}

export function deleteGuard(
  activity: { toolName: string; phase: string; at: string } | undefined | null,
  now: number = Date.now(),
): "ok" | "blocked" {
  if (!isSessionBusy(activity)) return "ok";
  return isActivityStuck({ activity, now }) ? "ok" : "blocked";
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
