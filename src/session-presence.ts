export type SessionPresence = "waiting" | "busy" | "idle";

export const IDLE_MS = 60_000;

/** Codex 的 PermissionRequest 收到後要滿這麼久才算「等你」；`auto_review` 之類會自動核可的請求多半在這之內完成，藉此濾掉誤報。 */
export const PERMISSION_REQUEST_GRACE_MS = 5_000;

export function isWaitingForUser(
  activity?: { toolName: string; phase: string; at?: string } | null,
  now: number = Date.now(),
): boolean {
  if (!activity || activity.phase !== "running") return false;
  if (activity.toolName === "AskUserQuestion" || activity.toolName === "ExitPlanMode") return true;
  if (activity.toolName === "PermissionRequest") {
    if (!activity.at) return false;
    const startedAt = Date.parse(activity.at);
    if (Number.isNaN(startedAt)) return false;
    return now - startedAt >= PERMISSION_REQUEST_GRACE_MS;
  }
  return false;
}

export function classifyPresence(input: {
  activity?: { toolName: string; phase: string; at?: string } | null;
  updatedAt: string;
  now?: number;
}): SessionPresence {
  const now = input.now ?? Date.now();
  if (isWaitingForUser(input.activity, now)) return "waiting";
  if (input.activity?.phase === "running") return "busy";
  return "idle";
}

export function aggregatePresence(items: SessionPresence[]): SessionPresence {
  if (items.includes("waiting")) return "waiting";
  if (items.includes("busy")) return "busy";
  return "idle";
}

export function presenceLabelPrefix(presence: SessionPresence): string {
  if (presence === "waiting") return "! ";
  if (presence === "busy") return "● ";
  return "○ ";
}

/** Ink Text color for session presence（整行標籤／標題用）。 */
export function presenceColor(presence: SessionPresence): "red" | "yellow" | "green" {
  if (presence === "waiting") return "red";
  if (presence === "busy") return "yellow";
  return "green";
}

export function waitingBannerMessage(toolName: string): string | undefined {
  if (toolName === "AskUserQuestion") return "正在等待你的回答 — 回到 Claude Code 視窗";
  if (toolName === "ExitPlanMode") return "正在等待你核准計畫 — 回到 Claude Code 視窗";
  if (toolName === "PermissionRequest") return "正在等你核可 — 回到 Codex 視窗";
  return undefined;
}

export function waitingNoticeForActivity(
  activity?: { toolName: string; phase: string; at?: string } | null,
  now: number = Date.now(),
): string | undefined {
  if (!activity || !isWaitingForUser(activity, now)) return undefined;
  return waitingBannerMessage(activity.toolName);
}

export function waitingEdgeKey(
  sessionId: string,
  activity: { toolName: string; at: string },
): string {
  return `${sessionId}:${activity.toolName}:${activity.at}`;
}

export function shouldRingWaitingBell(
  prevKey: string | undefined,
  nextKey: string | undefined,
): boolean {
  return nextKey !== undefined && nextKey !== prevKey;
}
