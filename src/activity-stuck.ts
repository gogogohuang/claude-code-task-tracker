import { isWaitingForUser } from "./session-presence.js";

export const STUCK_MS = 120_000;

export function isActivityStuck(input: {
  activity?: { toolName: string; phase: string; at: string } | null;
  now?: number;
}): boolean {
  const activity = input.activity;
  if (!activity || activity.phase !== "running") return false;
  const now = input.now ?? Date.now();
  if (isWaitingForUser(activity, now)) return false;
  const started = Date.parse(activity.at);
  if (Number.isNaN(started)) return false;
  return now - started >= STUCK_MS;
}

export function formatStuckLabel(activityAt: string, now: number = Date.now()): string {
  const started = Date.parse(activityAt);
  const elapsedMs = Number.isNaN(started) ? 0 : Math.max(0, now - started);
  if (elapsedMs < 60_000) {
    return `可能卡住（已 ${Math.floor(elapsedMs / 1000)}s）`;
  }
  return `可能卡住（已 ${Math.floor(elapsedMs / 60_000)}m）`;
}
