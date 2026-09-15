import { Advice } from "./types.js";

export function adviceForSession(advice: readonly Advice[], sessionId: string | undefined): Advice[] {
  if (sessionId === undefined) return [];
  return advice
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => right.at.localeCompare(left.at));
}
