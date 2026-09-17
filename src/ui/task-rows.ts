import { TaskItem, TaskState, TodoItem, WorkflowRun } from "../schema.js";

export type RowStatus = TodoItem["status"] | TaskItem["status"];

export interface TaskRow {
  key: string;
  status: RowStatus;
  label: string;
  suffix?: string;
}

const STATUS_ORDER: Record<RowStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  deleted: 3,
};

function rowsFromTasks(tasks: Record<string, TaskItem>): TaskRow[] {
  return Object.values(tasks).map((task) => {
    const label =
      (task.status === "in_progress" && task.activeForm) || task.subject || task.description || task.id;
    const suffixParts: string[] = [];
    if (task.owner) suffixParts.push(`@${task.owner}`);
    if (task.blockedBy && task.blockedBy.length > 0) suffixParts.push(`blocked by ${task.blockedBy.length}`);
    return {
      key: task.id,
      status: task.status,
      label,
      suffix: suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : undefined,
    };
  });
}

function rowsFromTodos(todos: TodoItem[]): TaskRow[] {
  return todos.map((todo, i) => ({
    key: todo.id ?? `${i}-${todo.content}`,
    status: todo.status,
    label: todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content,
  }));
}

function rowsFromWorkflow(run: WorkflowRun | undefined): TaskRow[] {
  if (!run) return [];
  const rows: TaskRow[] = [];
  for (const phase of run.phases) {
    rows.push({
      key: `wf:${run.runId}:${phase.title}`,
      status: phase.status,
      label: phase.title,
    });
    for (const step of phase.steps ?? []) {
      const summary = step.summary ? ` · ${step.summary}` : "";
      rows.push({
        key: `wf:${run.runId}:${phase.title}:${step.key}`,
        status: step.status,
        label: `  ${step.label}${summary}`,
      });
    }
  }
  return rows;
}

export function workItemRows(state: TaskState): TaskRow[] {
  const rows = [...rowsFromTasks(state.tasks ?? {}), ...rowsFromTodos(state.todos ?? [])];
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return rows;
}

export function taskRows(state: TaskState): TaskRow[] {
  return [...rowsFromWorkflow(state.workflow), ...workItemRows(state)];
}
