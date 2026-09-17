import assert from "node:assert/strict";
import test from "node:test";
import type { TaskState } from "../schema.js";
import {
  formatStatusLine,
  formatTmuxStatusLine,
  runStatus,
  statusFromState,
  type StatusDeps,
} from "./status.js";

const state: TaskState = {
  sessionId: "e9efe088-aaaa-bbbb-cccc-ddddeeeeffff",
  cwd: "/proj/a",
  updatedAt: "2026-09-16T10:00:00.000Z",
  tasks: {
    a: { id: "a", status: "completed", subject: "A" },
    b: { id: "b", status: "completed", subject: "B" },
    c: { id: "c", status: "completed", subject: "C" },
    d: { id: "d", status: "pending", subject: "D" },
    e: { id: "e", status: "pending", subject: "E" },
  },
  activity: {
    toolName: "Read",
    phase: "done",
    summary: "正在讀取 src/schema.ts",
    at: "2026-09-16T10:00:00.000Z",
  },
};

test("statusFromState 組出 presence／任務數／活動", () => {
  const payload = statusFromState(state);
  assert.equal(payload.sessionId, state.sessionId);
  assert.equal(payload.presence, "idle");
  assert.equal(payload.done, 3);
  assert.equal(payload.total, 5);
  assert.equal(payload.activitySummary, "正在讀取 src/schema.ts");
  assert.equal(payload.cwd, "/proj/a");
});

test("formatStatusLine 寫死格式", () => {
  assert.equal(
    formatStatusLine(statusFromState(state)),
    "idle · e9efe088 · ○ 3/5 · 正在讀取 src/schema.ts",
  );
});

test("無 task／todo 省略 ○ k/n；無活動省略活動欄", () => {
  assert.equal(
    formatStatusLine(
      statusFromState({
        sessionId: "abcdefgh-1111",
        updatedAt: "t",
      }),
    ),
    "idle · abcdefgh",
  );
});

test("busy 當 activity running", () => {
  const payload = statusFromState({
    ...state,
    activity: { toolName: "Bash", phase: "running", at: "t" },
  });
  assert.equal(payload.presence, "busy");
  assert.match(formatStatusLine(payload), /^busy ·/);
});

test("formatTmuxStatusLine：idle 用綠色徽章，不重複列 presence 文字", () => {
  assert.equal(
    formatTmuxStatusLine(statusFromState(state)),
    "#[fg=green]○#[default] e9efe088 · ○ 3/5 · 正在讀取 src/schema.ts",
  );
});

test("formatTmuxStatusLine：waiting 用紅色徽章", () => {
  const payload = statusFromState({
    ...state,
    activity: { toolName: "AskUserQuestion", phase: "running", at: "t" },
  });
  assert.equal(payload.presence, "waiting");
  assert.match(formatTmuxStatusLine(payload), /^#\[fg=red\]!#\[default\] /);
});

test("formatTmuxStatusLine：busy 用黃色徽章", () => {
  const payload = statusFromState({
    ...state,
    activity: { toolName: "Bash", phase: "running", at: "t" },
  });
  assert.match(formatTmuxStatusLine(payload), /^#\[fg=yellow\]●#\[default\] /);
});

test("formatTmuxStatusLine：無 session 回 none", () => {
  assert.equal(formatTmuxStatusLine({ sessionId: null }), "none");
});

test("runStatus --format tmux 輸出 tmux 色碼", () => {
  const lines: string[] = [];
  const deps: StatusDeps = {
    listSessionIds: () => [state.sessionId],
    readTaskState: () => state,
    log: (line) => lines.push(line),
    error: () => {},
  };
  assert.equal(runStatus({ format: "tmux", cwd: "/proj/a" }, deps), 0);
  assert.match(lines[0]!, /^#\[fg=green\]○#\[default\] /);
});

test("runStatus --json 仍等同 --format json（相容旗標）", () => {
  const lines: string[] = [];
  const deps: StatusDeps = {
    listSessionIds: () => [state.sessionId],
    readTaskState: () => state,
    log: (line) => lines.push(line),
    error: () => {},
  };
  assert.equal(runStatus({ json: true, cwd: "/proj/a" }, deps), 0);
  assert.equal(JSON.parse(lines[0]!).sessionId, state.sessionId);
});

test("runStatus 無 session → none exit 0", () => {
  const lines: string[] = [];
  const deps: StatusDeps = {
    listSessionIds: () => [],
    readTaskState: () => null,
    log: (line) => lines.push(line),
    error: () => {},
  };
  assert.equal(runStatus({}, deps), 0);
  assert.deepEqual(lines, ["none"]);
});

test("runStatus --json 無 session", () => {
  const lines: string[] = [];
  const deps: StatusDeps = {
    listSessionIds: () => [],
    readTaskState: () => null,
    log: (line) => lines.push(line),
    error: () => {},
  };
  assert.equal(runStatus({ json: true }, deps), 0);
  assert.deepEqual(JSON.parse(lines[0]!), { sessionId: null });
});

test("runStatus 偏好 cwd 對得上的 session", () => {
  const lines: string[] = [];
  const preferId = "prefer-prefer-prefer-prefer-prefee";
  const otherId = "other-other-other-other-otherooo";
  const byId: Record<string, TaskState> = {
    [otherId]: {
      sessionId: otherId,
      cwd: "/proj/b",
      updatedAt: "2026-09-16T12:00:00.000Z",
      tasks: { a: { id: "a", status: "pending", subject: "O" } },
    },
    [preferId]: {
      ...state,
      sessionId: preferId,
      cwd: "/proj/a",
      updatedAt: "2026-09-16T11:00:00.000Z",
    },
  };
  const deps: StatusDeps = {
    listSessionIds: () => Object.keys(byId),
    readTaskState: (id) => byId[id] ?? null,
    log: (line) => lines.push(line),
    error: () => {},
  };
  assert.equal(runStatus({ cwd: "/proj/a" }, deps), 0);
  assert.match(lines[0]!, /^idle · prefer-p · ○ 3\/5/);
});

test("runStatus --session 找不到 → exit 1", () => {
  const errs: string[] = [];
  const deps: StatusDeps = {
    listSessionIds: () => ["aaaa-bbbb"],
    readTaskState: () => null,
    log: () => {},
    error: (line) => errs.push(line),
  };
  assert.equal(runStatus({ session: "zzzz" }, deps), 1);
  assert.match(errs[0]!, /找不到 session/);
});
