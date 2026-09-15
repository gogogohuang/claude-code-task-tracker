import { groupSessionsByProject, sameCwd, SessionHint, shortSessionId } from "../session-preference.js";
import { Advice } from "./types.js";

export interface AdviceSession {
  sessionId: string;
  shortId: string;
  isCurrent: boolean;
  activitySummary: string | undefined;
  advice: Advice[];
}

export interface AdviceProjectGroup {
  key: string;
  label: string;
  sessions: AdviceSession[];
}

export function groupAdviceByProject(
  advice: readonly Advice[],
  sessions: readonly SessionHint[],
  watchCwd: string,
): AdviceProjectGroup[] {
  const advisedSessionIds = new Set(advice.map((a) => a.sessionId));
  const relevant = sessions.filter((session) => advisedSessionIds.has(session.sessionId));
  const groups = groupSessionsByProject(relevant, watchCwd);

  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    sessions: group.sessions.map((session) => ({
      sessionId: session.sessionId,
      shortId: shortSessionId(session.sessionId),
      isCurrent: sameCwd(session.cwd, watchCwd),
      activitySummary: session.activitySummary,
      advice: advice.filter((a) => a.sessionId === session.sessionId).sort((left, right) => right.at.localeCompare(left.at)),
    })),
  }));
}
