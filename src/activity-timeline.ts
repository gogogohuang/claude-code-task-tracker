export const TIMELINE_MAX = 40;

export interface TimelineEntry {
  at: string;
  toolName: string;
  phase: "running" | "done";
  summary?: string;
}

export function pushActivityToTimeline(
  prev: TimelineEntry[],
  activity: TimelineEntry | undefined,
  max: number = TIMELINE_MAX,
): TimelineEntry[] {
  if (!activity) return prev;
  const last = prev.at(-1);
  if (last && last.at === activity.at && last.phase === activity.phase && last.toolName === activity.toolName) {
    return prev;
  }
  let next: TimelineEntry[];
  if (activity.phase === "done" && last?.phase === "running" && last.toolName === activity.toolName) {
    next = [...prev.slice(0, -1), activity];
  } else {
    next = [...prev, activity];
  }
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}
