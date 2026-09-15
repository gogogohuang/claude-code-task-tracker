import { Activity } from "./schema.js";

export const CONTEXT_WINDOW_TOKENS = 1_000_000;

export function shouldShowContextSnapshot(shownSessionIds: ReadonlySet<string>, sessionId: string): boolean {
  return !shownSessionIds.has(sessionId);
}

export function formatOccupiedTokensLine(lastOccupiedTokens: number | undefined): string {
  if (lastOccupiedTokens === undefined) return "還沒有用量資料";
  const pct = Math.round((lastOccupiedTokens / CONTEXT_WINDOW_TOKENS) * 100);
  return `窗口約 ${lastOccupiedTokens.toLocaleString("en-US")} token（約 ${pct}%）`;
}

export function activityLineLabel(activity: Activity): string {
  const body =
    activity.summary ??
    (activity.phase === "running" ? `正在使用 ${activity.toolName}` : `已使用 ${activity.toolName}`);
  return activity.phase === "running" ? `◐ ${body}` : body;
}

export function formatSnapshotActivityLine(input: {
  activity?: Activity;
  done: number;
  total: number;
}): string | undefined {
  if (!input.activity && input.total === 0) return undefined;
  const taskPart = `任務 ${input.done}/${input.total}`;
  if (!input.activity) return taskPart;
  return `${activityLineLabel(input.activity)} · ${taskPart}`;
}
