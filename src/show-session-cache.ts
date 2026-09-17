import { readFileSync } from "node:fs";
import { TaskState } from "./schema.js";
import { formatRelativeAge } from "./format-relative-age.js";
import { SessionHint, normalizeOptionalCwd, sameCwd, shortSessionId } from "./session-preference.js";
import { readTaskState, statePathForSession } from "./store.js";

export function sessionHintFromState(state: TaskState): SessionHint {
  return {
    sessionId: state.sessionId,
    cwd: normalizeOptionalCwd(state.cwd),
    updatedAt: state.updatedAt,
    activitySummary: state.activity?.summary,
    activityToolName: state.activity?.toolName,
    activityPhase: state.activity?.phase,
  };
}

export function loadSessionHints(sessionIds: string[]): SessionHint[] {
  const hints: SessionHint[] = [];
  for (const sessionId of sessionIds) {
    const state = readTaskState(sessionId);
    if (!state) continue;
    hints.push(sessionHintFromState(state));
  }
  return hints;
}

export function resolveSessionId(query: string, sessionIds: string[]): string | undefined {
  if (sessionIds.includes(query)) return query;
  const trimmed = query.trim();
  const matches = sessionIds.filter(
    (id) => id.startsWith(trimmed) || shortSessionId(id).startsWith(trimmed),
  );
  if (matches.length === 1) return matches[0];
  return undefined;
}

export function filterSessionHints(hints: SessionHint[], cwd: string, all: boolean): SessionHint[] {
  const filtered = all ? hints : hints.filter((hint) => sameCwd(hint.cwd, cwd));
  return [...filtered].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function formatSessionListLine(hint: SessionHint, now: number = Date.now()): string {
  const age = formatRelativeAge(hint.updatedAt, now);
  const activity = hint.activitySummary ? ` · ${hint.activitySummary}` : "";
  const cwd = hint.cwd ? ` · ${hint.cwd}` : "";
  return `${shortSessionId(hint.sessionId)}  ${age}${activity}${cwd}`;
}

export function serializeSessionCache(state: TaskState, compact = false): string {
  return JSON.stringify(state, null, compact ? 0 : 2);
}

export function readSessionCacheRaw(sessionId: string): string | undefined {
  const path = statePathForSession(sessionId);
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}
