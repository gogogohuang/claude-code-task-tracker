import assert from "node:assert/strict";
import test from "node:test";
import type { TaskState } from "./schema.js";
import { pickNextTask } from "./next-task.js";

const base: TaskState = {
  sessionId: "s1",
  updatedAt: "t",
};

test("無 pending → undefined", () => {
  assert.equal(
    pickNextTask({
      ...base,
      tasks: { a: { id: "a", status: "completed", subject: "A" } },
    }),
    undefined,
  );
});

test("跳過 blockedBy 非空", () => {
  assert.deepEqual(
    pickNextTask({
      ...base,
      tasks: {
        blocked: {
          id: "blocked",
          status: "pending",
          subject: "被擋",
          blockedBy: ["x"],
        },
        free: { id: "free", status: "pending", subject: "可做" },
      },
    }),
    { label: "可做" },
  );
});

test("tasks 依 id 排序，整組優先於 todos", () => {
  assert.deepEqual(
    pickNextTask({
      ...base,
      tasks: {
        z: { id: "z", status: "pending", subject: "Z" },
        a: { id: "a", status: "pending", subject: "A" },
      },
      todos: [{ content: "Todo 先", status: "pending" }],
    }),
    { label: "A" },
  );
});

test("無 tasks 時取 todos 陣列順序第一個 pending", () => {
  assert.deepEqual(
    pickNextTask({
      ...base,
      todos: [
        { content: "done", status: "completed" },
        { content: "下一個 todo", status: "pending" },
      ],
    }),
    { label: "下一個 todo" },
  );
});

test("有 in_progress 仍可回下一個 pending", () => {
  assert.deepEqual(
    pickNextTask({
      ...base,
      tasks: {
        run: { id: "run", status: "in_progress", subject: "進行中" },
        next: { id: "next", status: "pending", subject: "下一個" },
      },
    }),
    { label: "下一個" },
  );
});
