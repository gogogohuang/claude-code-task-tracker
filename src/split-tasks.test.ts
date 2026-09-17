import assert from "node:assert/strict";
import test from "node:test";
import { SPLIT_TASK_ROWS } from "./split-layout.js";
import { visibleSplitTaskRows } from "./split-tasks.js";
import type { TaskRow } from "./ui/task-rows.js";

function row(key: string): TaskRow {
  return { key, status: "pending", label: key };
}

test("visibleSplitTaskRows 依 offset 切最多 N 列", () => {
  const rows = [row("1"), row("2"), row("3"), row("4"), row("5"), row("6")];
  assert.deepEqual(
    visibleSplitTaskRows(rows, 0, SPLIT_TASK_ROWS).map((r) => r.key),
    ["1", "2", "3", "4", "5"],
  );
  assert.deepEqual(
    visibleSplitTaskRows(rows, 2, SPLIT_TASK_ROWS).map((r) => r.key),
    ["3", "4", "5", "6"],
  );
  assert.deepEqual(visibleSplitTaskRows(rows, 10, SPLIT_TASK_ROWS), []);
});
