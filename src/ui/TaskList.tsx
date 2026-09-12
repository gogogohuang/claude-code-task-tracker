import { Box, Text } from "ink";
import { Activity, TaskItem, TaskState, TodoItem } from "../schema.js";

type Status = TodoItem["status"] | TaskItem["status"];

const STATUS_ICON: Record<Status, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✔",
  deleted: "✖",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  deleted: "gray",
};

interface Row {
  key: string;
  status: Status;
  label: string;
  suffix?: string;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const width = 24;
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <Text>
      <Text color="green">{bar}</Text> {pct}% ({done}/{total})
    </Text>
  );
}

function rowsFromTasks(tasks: Record<string, TaskItem>): Row[] {
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

function rowsFromTodos(todos: TodoItem[]): Row[] {
  return todos.map((todo, i) => ({
    key: `${i}-${todo.content}`,
    status: todo.status,
    label: todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content,
  }));
}

function ActivityLine({ activity }: { activity: Activity }) {
  const time = new Date(activity.at).toLocaleTimeString();
  const label =
    activity.summary ??
    (activity.phase === "running" ? `正在使用 ${activity.toolName}` : `已使用 ${activity.toolName}`);

  if (activity.phase === "running") {
    return (
      <Text color="yellow">
        ◐ {label}
        <Text dimColor> ({time} 開始)</Text>
      </Text>
    );
  }
  return (
    <Text dimColor>
      {label} ({time} 完成)
    </Text>
  );
}

export function TaskList({ state }: { state: TaskState }) {
  const rows =
    state.tasks && Object.keys(state.tasks).length > 0
      ? rowsFromTasks(state.tasks)
      : rowsFromTodos(state.todos ?? []);
  const done = rows.filter((r) => r.status === "completed").length;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Session: </Text>
        <Text color="cyan">{state.sessionId}</Text>
        {state.cwd ? <Text dimColor> ({state.cwd})</Text> : null}
      </Box>

      {state.activity ? (
        <Box marginBottom={1}>
          <ActivityLine activity={state.activity} />
        </Box>
      ) : null}

      <Box marginBottom={1}>
        <ProgressBar done={done} total={rows.length} />
      </Box>

      {rows.length === 0 ? (
        <Text dimColor>目前沒有 task。</Text>
      ) : (
        <Box flexDirection="column">
          {rows.map((row) => (
            <Text key={row.key} color={STATUS_COLOR[row.status]}>
              {STATUS_ICON[row.status]} {row.label}
              {row.suffix ? <Text dimColor>{row.suffix}</Text> : null}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>最後更新：{new Date(state.updatedAt).toLocaleTimeString()} — 按 q 離開</Text>
      </Box>
    </Box>
  );
}
