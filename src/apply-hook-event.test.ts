import assert from "node:assert/strict";
import test from "node:test";
import { applyHookEvent } from "./hook/apply-event.js";
import { TaskState } from "./schema.js";

function capture() {
  const written: TaskState[] = [];
  const logs: string[] = [];
  const states = new Map<string, TaskState>();
  return {
    written,
    logs,
    deps: {
      readTaskState: (id: string) => states.get(id) ?? null,
      writeTaskState: (state: TaskState) => {
        states.set(state.sessionId, state);
        written.push(state);
      },
      appendDebugLog: (message: string) => {
        logs.push(message);
      },
      now: () => new Date("2026-09-15T01:00:00.000Z"),
    },
  };
}

test("SessionStart 沒有 tool_name 也會建立 session 狀態檔", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      cwd: "/proj",
      hook_event_name: "SessionStart",
      tool_input: undefined,
    },
    deps,
  );
  assert.equal(written.length, 1);
  assert.equal(written[0].sessionId, "abc");
  assert.equal(written[0].cwd, "/proj");
  assert.equal(written[0].activity?.summary, "工作階段已開始");
  assert.equal(written[0].activity?.toolName, "SessionStart");
  assert.equal(written[0].activity?.phase, "done");
});

test("SessionStart 在工具執行中不覆蓋進行中的活動", () => {
  const { written, deps } = capture();
  deps.writeTaskState({
    sessionId: "abc",
    updatedAt: "2026-09-15T00:59:00.000Z",
    activity: {
      toolName: "Read",
      phase: "running",
      summary: "正在讀取 src/schema.ts",
      at: "2026-09-15T00:59:00.000Z",
    },
  });
  applyHookEvent({ session_id: "abc", hook_event_name: "SessionStart", tool_input: undefined }, deps);
  assert.equal(written.at(-1)?.activity?.summary, "正在讀取 src/schema.ts");
  assert.equal(written.at(-1)?.activity?.phase, "running");
});

test("PreToolUse 仍會寫成正在執行的活動句", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      cwd: "/proj",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/proj/src/cli.tsx" },
    },
    deps,
  );
  assert.equal(written[0].activity?.phase, "running");
  assert.equal(written[0].activity?.summary, "正在讀取 src/cli.tsx");
});

test("TaskCreated 用官方欄位寫入進行中的 task", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "TaskCreated",
      task_id: "task-001",
      task_subject: "實作登入",
      task_description: "加上 JWT",
      teammate_name: "implementer",
    },
    deps,
  );
  const task = written.at(-1)?.tasks?.["task-001"];
  assert.equal(task?.status, "in_progress");
  assert.equal(task?.subject, "實作登入");
  assert.equal(task?.description, "加上 JWT");
  assert.equal(task?.owner, "implementer");
  assert.equal(written.at(-1)?.activity?.summary, "已建立任務 實作登入");
});

test("TaskCompleted 把對應 task 標成完成", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "TaskCreated",
      task_id: "task-001",
      task_subject: "實作登入",
    },
    deps,
  );
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "TaskCompleted",
      task_id: "task-001",
      task_subject: "實作登入",
    },
    deps,
  );
  assert.equal(written.at(-1)?.tasks?.["task-001"]?.status, "completed");
});

test("TaskCreate 沒給 status 時視為進行中，不是 pending", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "PostToolUse",
      tool_name: "TaskCreate",
      tool_input: { subject: "修測試" },
      tool_response: { taskId: "t-2" },
    },
    deps,
  );
  assert.equal(written.at(-1)?.tasks?.["t-2"]?.status, "in_progress");
  assert.equal(written.at(-1)?.tasks?.["t-2"]?.subject, "修測試");
});

test("TaskUpdate 接受 id 當 taskId，才能把狀態改成進行中", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "PostToolUse",
      tool_name: "TaskCreate",
      tool_input: { title: "寫文件" },
      tool_response: { id: "t-3" },
    },
    deps,
  );
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "PostToolUse",
      tool_name: "TaskUpdate",
      tool_input: { id: "t-3", status: "in_progress" },
    },
    deps,
  );
  assert.equal(written.at(-1)?.tasks?.["t-3"]?.status, "in_progress");
  assert.equal(written.at(-1)?.tasks?.["t-3"]?.subject, "寫文件");
});

test("TodoWrite merge:true 會留下既有項目並更新進行中那筆", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "PostToolUse",
      tool_name: "TodoWrite",
      tool_input: {
        todos: [
          { id: "a", content: "先列清單", status: "pending" },
          { id: "b", content: "修 bug", status: "pending" },
        ],
      },
    },
    deps,
  );
  applyHookEvent(
    {
      session_id: "abc",
      hook_event_name: "PostToolUse",
      tool_name: "TodoWrite",
      tool_input: {
        merge: true,
        todos: [{ id: "b", content: "修 bug", status: "in_progress", activeForm: "正在修 bug" }],
      },
    },
    deps,
  );
  const todos = written.at(-1)?.todos ?? [];
  assert.equal(todos.length, 2);
  assert.equal(todos.find((t) => t.content === "先列清單")?.status, "pending");
  assert.equal(todos.find((t) => t.content === "修 bug")?.status, "in_progress");
  assert.equal(todos.find((t) => t.content === "修 bug")?.activeForm, "正在修 bug");
});
