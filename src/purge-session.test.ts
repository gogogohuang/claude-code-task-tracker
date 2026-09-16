import assert from "node:assert/strict";
import test from "node:test";
import { TaskState } from "./schema.js";
import {
  PURGE_DONE_NOTICE,
  purgeSessionState,
  shouldOpenPurgeMenu,
  withoutSessionAdvice,
} from "./purge-session.js";

const base: TaskState = {
  sessionId: "s1",
  cwd: "/tmp/p",
  updatedAt: "2026-01-01T00:00:00.000Z",
  todos: [
    { content: "done-todo", status: "completed" },
    { content: "open-todo", status: "pending" },
    { content: "busy-todo", status: "in_progress" },
  ],
  tasks: {
    t1: { id: "t1", subject: "done", status: "completed" },
    t2: { id: "t2", subject: "open", status: "pending" },
    t3: { id: "t3", subject: "busy", status: "in_progress" },
  },
  activity: { toolName: "Read", phase: "done", summary: "已讀取 a", at: "t" },
  workflow: {
    runId: "w1",
    journalPath: "/tmp/j",
    phases: [{ title: "p", status: "pending" }],
  },
};

test("輕清：刪 completed、清 activity，保留 pending/in_progress 與 workflow", () => {
  const next = purgeSessionState(base, "light", () => "2026-09-16T00:00:00.000Z");
  assert.equal(next.updatedAt, "2026-09-16T00:00:00.000Z");
  assert.equal(next.activity, undefined);
  assert.deepEqual(next.todos, [
    { content: "open-todo", status: "pending" },
    { content: "busy-todo", status: "in_progress" },
  ]);
  assert.deepEqual(next.tasks, {
    t2: { id: "t2", subject: "open", status: "pending" },
    t3: { id: "t3", subject: "busy", status: "in_progress" },
  });
  assert.deepEqual(next.workflow, base.workflow);
  assert.equal(next.sessionId, "s1");
  assert.equal(next.cwd, "/tmp/p");
});

test("重清：整包清空 todo/task、清 activity，保留殼與 workflow", () => {
  const next = purgeSessionState(base, "heavy", () => "2026-09-16T00:00:00.000Z");
  assert.equal(next.activity, undefined);
  assert.deepEqual(next.todos, []);
  assert.deepEqual(next.tasks, {});
  assert.deepEqual(next.workflow, base.workflow);
});

test("running 時兩檔都保留 activity", () => {
  const running: TaskState = {
    ...base,
    activity: { toolName: "Bash", phase: "running", summary: "正在跑", at: "t" },
  };
  assert.deepEqual(purgeSessionState(running, "light", () => "n").activity, running.activity);
  assert.deepEqual(purgeSessionState(running, "heavy", () => "n").activity, running.activity);
});

test("withoutSessionAdvice 只拿掉指定 session", () => {
  const list = [
    { sessionId: "s1", kind: "long-session" as const, message: "a", at: "t" },
    { sessionId: "s2", kind: "long-session" as const, message: "b", at: "t" },
  ];
  assert.deepEqual(withoutSessionAdvice(list, "s1"), [list[1]]);
});

test("shouldOpenPurgeMenu 只在 main 且已選 session", () => {
  assert.equal(shouldOpenPurgeMenu("main", "s1"), true);
  assert.equal(shouldOpenPurgeMenu("advice", "s1"), false);
  assert.equal(shouldOpenPurgeMenu("main", undefined), false);
});

test("PURGE_DONE_NOTICE 文案固定", () => {
  assert.equal(PURGE_DONE_NOTICE.light, "已輕清建議與已完成任務");
  assert.equal(PURGE_DONE_NOTICE.heavy, "已重清建議與全部任務清單");
});
