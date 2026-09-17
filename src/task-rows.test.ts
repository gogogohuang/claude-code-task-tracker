import assert from "node:assert/strict";
import test from "node:test";
import { taskRows, workItemRows } from "./ui/task-rows.js";

test("taskRows 合併 todos 與 tasks，進行中排最前", () => {
  const rows = taskRows({
    sessionId: "abc",
    updatedAt: "2026-09-15T01:00:00.000Z",
    todos: [
      { content: "寫測試", status: "pending" },
      { content: "修 bug", status: "in_progress", activeForm: "正在修 bug" },
    ],
    tasks: {
      "t-1": { id: "t-1", subject: "已完成的", status: "completed" },
    },
  });
  assert.deepEqual(
    rows.map((row) => row.label),
    ["正在修 bug", "寫測試", "已完成的"],
  );
  assert.equal(rows[0].status, "in_progress");
});

test("taskRows 把 workflow phases 依宣告順序放在 task 前面", () => {
  const rows = taskRows({
    sessionId: "abc",
    updatedAt: "2026-09-15T01:00:00.000Z",
    todos: [{ content: "寫測試", status: "pending" }],
    workflow: {
      runId: "wf_1",
      journalPath: "/tmp/journal.jsonl",
      phases: [
        { title: "Fetch Ticket + Write Plan", status: "completed" },
        { title: "Execute Plan", status: "in_progress" },
        { title: "Gate", status: "pending" },
      ],
    },
  });
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Fetch Ticket + Write Plan", "Execute Plan", "Gate", "寫測試"],
  );
  assert.equal(rows[1].status, "in_progress");
});

test("workItemRows 只含 todos／tasks，不含 workflow（給無標籤進度條用）", () => {
  const state = {
    sessionId: "abc",
    updatedAt: "2026-09-15T01:00:00.000Z",
    todos: [{ content: "寫測試", status: "pending" as const }],
    workflow: {
      runId: "wf_1",
      journalPath: "/tmp/journal.jsonl",
      phases: [
        { title: "Read Ticket", status: "pending" as const },
        { title: "Plan", status: "pending" as const },
      ],
    },
  };
  assert.deepEqual(
    workItemRows(state).map((row) => row.label),
    ["寫測試"],
  );
  assert.deepEqual(workItemRows({ ...state, todos: undefined }).map((row) => row.label), []);
});

test("taskRows 在 phase 下縮排顯示 step label 與短摘要", () => {
  const rows = taskRows({
    sessionId: "abc",
    updatedAt: "2026-09-15T01:00:00.000Z",
    workflow: {
      runId: "wf_1",
      journalPath: "/tmp/journal.jsonl",
      phases: [
        {
          title: "Plan",
          status: "in_progress",
          steps: [
            {
              key: "a",
              label: "plan",
              status: "completed",
              summary: "Drafted a single-task plan",
            },
            { key: "b", label: "grill-plan", status: "in_progress" },
          ],
        },
      ],
    },
  });
  assert.deepEqual(
    rows.map((row) => `${row.status}:${row.label}`),
    [
      "in_progress:Plan",
      "completed:  plan · Drafted a single-task plan",
      "in_progress:  grill-plan",
    ],
  );
});
