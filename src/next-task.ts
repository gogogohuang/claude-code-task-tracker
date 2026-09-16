import type { TaskItem, TaskState } from "./schema.js";

export function pickNextTask(state: TaskState): { label: string } | undefined {
  const tasks = Object.values(state.tasks ?? {})
    .filter((task) => task.status === "pending" && !(task.blockedBy && task.blockedBy.length > 0))
    .sort((a, b) => a.id.localeCompare(b.id));

  const firstTask = tasks[0];
  if (firstTask) return { label: labelForTask(firstTask) };

  const todo = (state.todos ?? []).find((item) => item.status === "pending");
  if (todo) return { label: todo.content };
  return undefined;
}

function labelForTask(task: TaskItem): string {
  return task.subject || task.description || task.id;
}
