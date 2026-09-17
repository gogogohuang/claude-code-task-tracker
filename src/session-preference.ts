import { basename, resolve } from "node:path";
import { formatRelativeAge } from "./format-relative-age.js";
import {
  aggregatePresence,
  classifyPresence,
  presenceLabelPrefix,
  type SessionPresence,
} from "./session-presence.js";

export interface SessionHint {
  sessionId: string;
  cwd?: string;
  updatedAt: string;
  title?: string;
  firstPrompt?: string;
  /** 該 session 目前的活動摘要（TaskState.activity.summary），只有用量建議面板需要顯示時才會帶。 */
  activitySummary?: string;
  activityToolName?: string;
  activityPhase?: string;
}

export interface SessionChoice {
  label: string;
  value: string;
  presence: SessionPresence;
}

export interface ProjectGroup {
  key: string;
  label: string;
  cwd?: string;
  sessions: SessionHint[];
}

const UNKNOWN_PROJECT_KEY = "";

export function projectKeyFor(cwd?: string): string {
  return cwd ? resolve(cwd) : UNKNOWN_PROJECT_KEY;
}

export function sameCwd(left?: string, right?: string): boolean {
  const a = normalizeOptionalCwd(left);
  const b = normalizeOptionalCwd(right);
  if (!a || !b) return false;
  return resolve(a) === resolve(b);
}

/** 空白或空字串 cwd 視同未設定（Cursor / 舊檔常見）。 */
export function normalizeOptionalCwd(cwd?: string): string | undefined {
  if (cwd === undefined) return undefined;
  const trimmed = cwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function newestFirst(left: SessionHint, right: SessionHint): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

/** 沒有 cwd 的狀態檔不進專案配對池；全無 cwd 時退回全域最新（給 status）。 */
function sessionsWithCwd(sessions: SessionHint[]): Array<SessionHint & { cwd: string }> {
  return sessions.flatMap((session) => {
    const cwd = normalizeOptionalCwd(session.cwd);
    return cwd ? [{ ...session, cwd }] : [];
  });
}

export function pickPreferredSession(sessions: SessionHint[], watchCwd: string): string | undefined {
  const known = sessionsWithCwd(sessions);
  if (known.length === 0) {
    if (sessions.length === 0) return undefined;
    return [...sessions].sort(newestFirst)[0]?.sessionId;
  }
  const matching = known.filter((session) => sameCwd(session.cwd, watchCwd));
  const pool = matching.length > 0 ? matching : known;
  return [...pool].sort(newestFirst)[0]?.sessionId;
}

export function shouldAutoSelectSession(sessions: SessionHint[], watchCwd: string): boolean {
  const known = sessionsWithCwd(sessions);
  if (known.length === 0) return false;
  if (known.length <= 1) return true;
  return known.some((session) => sameCwd(session.cwd, watchCwd));
}

const LABEL_PART_LIMIT = 32;

export function clipLabelPart(value: string): string {
  return value.length > LABEL_PART_LIMIT ? `${value.slice(0, LABEL_PART_LIMIT)}…` : value;
}

function presenceForHint(session: SessionHint, now: number): SessionPresence {
  const activity =
    session.activityToolName && session.activityPhase
      ? { toolName: session.activityToolName, phase: session.activityPhase }
      : undefined;
  return classifyPresence({ activity, updatedAt: session.updatedAt, now });
}

function formatSessionLabel(session: SessionHint, marker: "current" | "recent" | undefined, now: number): string {
  const id = shortSessionId(session.sessionId);
  const head = marker === "current" ? `${id}  (目前)` : marker === "recent" ? `${id}  (最近)` : id;
  const parts = [head];
  const title = session.title ?? session.firstPrompt;
  if (title) parts.push(clipLabelPart(title));
  if (session.activitySummary) parts.push(clipLabelPart(session.activitySummary));
  const age = formatRelativeAge(session.updatedAt, now);
  if (age) parts.push(age);
  return `${presenceLabelPrefix(presenceForHint(session, now))}${parts.join(" · ")}`;
}

export function sessionChoices(sessions: SessionHint[], watchCwd: string, now: number = Date.now()): SessionChoice[] {
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
        now,
      ),
      presence: presenceForHint(session, now),
    }));
}

export function groupSessionsByProject(sessions: SessionHint[], watchCwd: string): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const cwd = normalizeOptionalCwd(session.cwd);
    const key = projectKeyFor(cwd);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    groups.set(key, {
      key,
      label: cwd ? basename(cwd) : "未知專案",
      cwd,
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
    return newestFirst(left.sessions[0], right.sessions[0]);
  });
}

export function projectChoices(sessions: SessionHint[], watchCwd: string, now: number = Date.now()): SessionChoice[] {
  return groupSessionsByProject(sessions, watchCwd).map((group) => {
    const current = sameCwd(group.cwd, watchCwd);
    const count = group.sessions.length;
    const suffix = current ? `${count} · 目前` : `${count}`;
    const presence = aggregatePresence(group.sessions.map((session) => presenceForHint(session, now)));
    return {
      value: group.key,
      label: `${presenceLabelPrefix(presence)}${group.label}  (${suffix})`,
      presence,
    };
  });
}

export function sessionChoicesInProject(
  sessions: SessionHint[],
  projectKey: string,
  watchCwd: string,
  now: number = Date.now(),
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
    .map((session) => ({
      value: session.sessionId,
      label: formatSessionLabel(
        session,
        session.sessionId !== preferred ? undefined : cwdMatched ? "current" : "recent",
        now,
      ),
      presence: presenceForHint(session, now),
    }));
}

export function addedSessionIds(previous: string[], current: string[]): string[] {
  const seen = new Set(previous);
  return current.filter((id) => !seen.has(id));
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

export function formatNewSessionNotice(sessions: Array<{ sessionId: string; cwd?: string }>): string {
  if (sessions.length !== 1) return `偵測到 ${sessions.length} 個新 session — 按 b 回列表`;
  const session = sessions[0];
  const place = session.cwd ? basename(session.cwd) : undefined;
  const id = shortSessionId(session.sessionId);
  return place ? `偵測到新 session：${place} · ${id} — 按 b 回列表` : `偵測到新 session：${id} — 按 b 回列表`;
}

