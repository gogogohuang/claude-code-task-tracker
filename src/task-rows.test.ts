import assert from "node:assert/strict";
import test from "node:test";
import { taskRows } from "./ui/task-rows.js";

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
