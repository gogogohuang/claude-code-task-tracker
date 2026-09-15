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

export interface ProjectGroup {
  key: string;
  label: string;
  cwd?: string;
  sessions: SessionHint[];
}

const UNKNOWN_PROJECT_KEY = "";
const UNKNOWN_PROJECT_LABEL = "未知專案";

export function projectKeyFor(cwd?: string): string {
  return cwd ? resolve(cwd) : UNKNOWN_PROJECT_KEY;
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

export function groupSessionsByProject(sessions: SessionHint[], watchCwd: string): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const key = projectKeyFor(session.cwd);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    groups.set(key, {
      key,
      label: session.cwd ? basename(session.cwd) : UNKNOWN_PROJECT_LABEL,
      cwd: session.cwd,
      sessions: [session],
    });
  }
  for (const group of groups.values()) {
    group.sessions.sort(newestFirst);
  }
  return [...groups.values()].sort((left, right) => {
    const leftCurrent = sameCwd(left.cwd, watchCwd);
    const rightCurrent = sameCwd(right.cwd, watchCwd);
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    if (!left.cwd !== !right.cwd) return left.cwd ? -1 : 1;
    return newestFirst(left.sessions[0], right.sessions[0]);
  });
}

export function projectChoices(sessions: SessionHint[], watchCwd: string): SessionChoice[] {
  return groupSessionsByProject(sessions, watchCwd).map((group) => {
    const current = sameCwd(group.cwd, watchCwd);
    const count = group.sessions.length;
    const suffix = current ? `${count} · 目前` : `${count}`;
    return { value: group.key, label: `${group.label}  (${suffix})` };
  });
}

export function sessionChoicesInProject(
  sessions: SessionHint[],
  projectKey: string,
  watchCwd: string,
): SessionChoice[] {
  const inProject = sessions.filter((session) => projectKeyFor(session.cwd) === projectKey);
  const preferred = pickPreferredSession(inProject, watchCwd);
  const cwdMatched = sameCwd(
    inProject.find((session) => session.sessionId === preferred)?.cwd,
    watchCwd,
  );
  return [...inProject]
    .sort((left, right) => {
      if (left.sessionId === preferred) return -1;
      if (right.sessionId === preferred) return 1;
      return newestFirst(left, right);
    })
    .map((session) => {
      const marker = session.sessionId !== preferred ? undefined : cwdMatched ? "current" : "recent";
      if (marker === "current") return { value: session.sessionId, label: `${session.sessionId}  (目前)` };
      if (marker === "recent") return { value: session.sessionId, label: `${session.sessionId}  (最近)` };
      return { value: session.sessionId, label: session.sessionId };
    });
}
