import { basename, resolve } from "node:path";

export interface SessionHint {
  sessionId: string;
  cwd?: string;
  updatedAt: string;
}

export interface SessionChoice {
  label: string;
  value: string;
}

export function sameCwd(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return resolve(left) === resolve(right);
}

function newestFirst(left: SessionHint, right: SessionHint): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function pickPreferredSession(sessions: SessionHint[], watchCwd: string): string | undefined {
  if (sessions.length === 0) return undefined;
  const matching = sessions.filter((session) => sameCwd(session.cwd, watchCwd));
  const pool = matching.length > 0 ? matching : sessions;
  return [...pool].sort(newestFirst)[0]?.sessionId;
}

export function shouldAutoSelectSession(sessions: SessionHint[], watchCwd: string): boolean {
  if (sessions.length <= 1) return true;
  return sessions.some((session) => sameCwd(session.cwd, watchCwd));
}

function formatSessionLabel(session: SessionHint, marker: "current" | "recent" | undefined): string {
  const place = session.cwd ? basename(session.cwd) : undefined;
  if (marker === "current") return place ? `${session.sessionId}  (目前 · ${place})` : `${session.sessionId}  (目前)`;
  if (marker === "recent") return place ? `${session.sessionId}  (最近 · ${place})` : `${session.sessionId}  (最近)`;
  return place ? `${session.sessionId}  (${place})` : session.sessionId;
}

export function sessionChoices(sessions: SessionHint[], watchCwd: string): SessionChoice[] {
  const preferred = pickPreferredSession(sessions, watchCwd);
  const cwdMatched = sessions.some((session) => sameCwd(session.cwd, watchCwd));
  return [...sessions]
    .sort((left, right) => {
      if (left.sessionId === preferred) return -1;
      if (right.sessionId === preferred) return 1;
      return newestFirst(left, right);
    })
    .map((session) => ({
      value: session.sessionId,
      label: formatSessionLabel(
        session,
        session.sessionId !== preferred ? undefined : cwdMatched ? "current" : "recent",
      ),
    }));
}
