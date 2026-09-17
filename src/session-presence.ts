export type SessionPresence = "waiting" | "busy" | "idle";

export const IDLE_MS = 60_000;

export function isWaitingForUser(
  activity?: { toolName: string; phase: string } | null,
): boolean {
  if (!activity || activity.phase !== "running") return false;
  return activity.toolName === "AskUserQuestion" || activity.toolName === "ExitPlanMode";
}

export function classifyPresence(input: {
  activity?: { toolName: string; phase: string } | null;
  updatedAt: string;
  now?: number;
}): SessionPresence {
  if (isWaitingForUser(input.activity)) return "waiting";
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
  return undefined;
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
