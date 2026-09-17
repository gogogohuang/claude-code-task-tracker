import type { TaskRow } from "./ui/task-rows.js";
import { SPLIT_TASK_ROWS } from "./split-layout.js";

export function visibleSplitTaskRows(
  rows: TaskRow[],
  offset: number,
  limit: number = SPLIT_TASK_ROWS,
): TaskRow[] {
  const start = Math.max(0, offset);
  return rows.slice(start, start + limit);
}
