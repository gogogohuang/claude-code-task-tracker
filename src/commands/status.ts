import { classifyPresence, type SessionPresence } from "../session-presence.js";
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

export interface RunStatusOptions {
  session?: string;
  json?: boolean;
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
    presence: classifyPresence({
      activity: state.activity,
      updatedAt: state.updatedAt,
      now,
    }),
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

export function runStatus(opts: RunStatusOptions = {}, deps: StatusDeps = defaultDeps): number {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? Date.now();
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
    if (opts.json) {
      deps.log(JSON.stringify({ sessionId: null }));
    } else {
      deps.log("none");
    }
    return 0;
  }

  const state = deps.readTaskState(sessionId);
  if (!state) {
    if (opts.json) {
      deps.log(JSON.stringify({ sessionId: null }));
    } else {
      deps.log("none");
    }
    return 0;
  }

  const payload = statusFromState(state, now);
  if (opts.json) {
    deps.log(JSON.stringify(payload));
  } else {
    deps.log(formatStatusLine(payload));
  }
  return 0;
}
