import { activityLineLabel } from "./context-snapshot.js";
import type { TaskState } from "./schema.js";

export const ENDED_MS = 300_000;

function hasInProgressWork(state: TaskState): boolean {
  if (state.tasks && Object.values(state.tasks).some((t) => t.status === "in_progress")) {
    return true;
  }
  if (state.todos?.some((t) => t.status === "in_progress")) return true;
  if (state.workflow?.phases.some((p) => p.status === "in_progress")) return true;
  return false;
}

export function isSessionEnded(state: TaskState, now: number = Date.now()): boolean {
  const activity = state.activity;
  if (activity && activity.phase !== "done") return false;
  const updated = Date.parse(state.updatedAt);
  if (Number.isNaN(updated) || now - updated < ENDED_MS) return false;
  if (hasInProgressWork(state)) return false;
  return true;
}

function taskDoneTotal(state: TaskState): { done: number; total: number } | undefined {
  const tasks = state.tasks ? Object.values(state.tasks).filter((t) => t.status !== "deleted") : [];
  const todos = state.todos ?? [];
  const items = [...tasks, ...todos];
  if (items.length === 0) return undefined;
  const done = items.filter((item) => item.status === "completed").length;
  return { done, total: items.length };
}

export function formatEndedSummary(state: TaskState): string {
  const counts = taskDoneTotal(state);
  const taskPart = counts ? `任務 ${counts.done}/${counts.total}` : "任務 —";
  const last = state.activity ? activityLineLabel(state.activity) : "無活動";
  return `Session 似乎已結束 · ${taskPart} · 最後：${last}`;
}
