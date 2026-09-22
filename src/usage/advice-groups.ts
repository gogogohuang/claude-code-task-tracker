import { Advice } from "./types.js";

const SEVERITY_RANK: Record<Advice["severity"], number> = { critical: 0, warn: 1 };

/** critical 排在 warn 前面，同 severity 依時間新到舊。 */
export function adviceForSession(advice: readonly Advice[], sessionId: string | undefined): Advice[] {
  if (sessionId === undefined) return [];
  return advice
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => {
      const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDiff !== 0) return severityDiff;
      return right.at.localeCompare(left.at);
    });
}
