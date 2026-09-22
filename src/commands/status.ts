import { presenceColor, presenceLabelPrefix, type SessionPresence } from "../session-presence.js";
import { resolvePresence } from "../status-detect.js";
import { pickPreferredSession, shortSessionId } from "../session-preference.js";
import type { TaskState } from "../schema.js";
import { resolveSessionId, sessionHintFromState } from "../show-session-cache.js";
import { listSessionIds, readTaskState } from "../store.js";

export interface StatusPayload {
  sessionId: string | null;
  presence?: SessionPresence;
  done?: number;
  total?: number;
  activitySummary?: string;
  cwd?: string;
}

export type StatusFormat = "plain" | "json" | "tmux";

export interface RunStatusOptions {
  session?: string;
  json?: boolean;
  format?: StatusFormat;
  cwd?: string;
  now?: number;
}

export interface StatusDeps {
  listSessionIds: () => string[];
  readTaskState: (sessionId: string) => TaskState | null;
  log: (line: string) => void;
  error: (line: string) => void;
}

const defaultDeps: StatusDeps = {
  listSessionIds,
  readTaskState,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

function taskDoneTotal(state: TaskState): { done: number; total: number } | undefined {
  const tasks = state.tasks ? Object.values(state.tasks) : [];
  const todos = state.todos ?? [];
  const items = [...tasks, ...todos];
  if (items.length === 0) return undefined;
  const done = items.filter((item) => item.status === "completed").length;
  return { done, total: items.length };
}

export function statusFromState(state: TaskState, now: number = Date.now()): StatusPayload {
  const counts = taskDoneTotal(state);
  return {
    sessionId: state.sessionId,
    presence: resolvePresence(state, now).presence,
    done: counts?.done,
    total: counts?.total,
    activitySummary: state.activity?.summary,
    cwd: state.cwd,
  };
}

export function formatStatusLine(payload: StatusPayload): string {
  if (payload.sessionId === null) return "none";
  const parts = [
    payload.presence ?? "idle",
    shortSessionId(payload.sessionId),
  ];
  if (payload.total !== undefined && payload.done !== undefined) {
    parts.push(`○ ${payload.done}/${payload.total}`);
  }
  if (payload.activitySummary) parts.push(payload.activitySummary);
  return parts.join(" · ");
}

/** tmux status-right 用：presence 徽章包 tmux 色碼（`#[fg=...]`/`#[default]`），其餘沿用 plain 格式。 */
export function formatTmuxStatusLine(payload: StatusPayload): string {
  if (payload.sessionId === null) return "none";
  const presence = payload.presence ?? "idle";
  const badge = presenceLabelPrefix(presence).trim();
  const color = presenceColor(presence);
  const parts = [shortSessionId(payload.sessionId)];
  if (payload.total !== undefined && payload.done !== undefined) {
    parts.push(`○ ${payload.done}/${payload.total}`);
  }
  if (payload.activitySummary) parts.push(payload.activitySummary);
  return `#[fg=${color}]${badge}#[default] ${parts.join(" · ")}`;
}

export function runStatus(opts: RunStatusOptions = {}, deps: StatusDeps = defaultDeps): number {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? Date.now();
  const format: StatusFormat = opts.format ?? (opts.json ? "json" : "plain");
  const sessionIds = deps.listSessionIds();

  let sessionId: string | undefined;
  if (opts.session) {
    sessionId = resolveSessionId(opts.session, sessionIds);
    if (!sessionId) {
      deps.error(`找不到 session：${opts.session}`);
      return 1;
    }
  } else {
    const hints = [];
    for (const id of sessionIds) {
      const hintState = deps.readTaskState(id);
      if (!hintState) continue;
      hints.push(sessionHintFromState(hintState));
    }
    sessionId = pickPreferredSession(hints, cwd);
  }

  if (!sessionId) {
    if (format === "json") {
      deps.log(JSON.stringify({ sessionId: null }));
    } else {
      deps.log("none");
    }
    return 0;
  }

  const state = deps.readTaskState(sessionId);
  if (!state) {
    if (format === "json") {
      deps.log(JSON.stringify({ sessionId: null }));
    } else {
      deps.log("none");
    }
    return 0;
  }

  const payload = statusFromState(state, now);
  if (format === "json") {
    deps.log(JSON.stringify(payload));
  } else if (format === "tmux") {
    deps.log(formatTmuxStatusLine(payload));
  } else {
    deps.log(formatStatusLine(payload));
  }
  return 0;
}
