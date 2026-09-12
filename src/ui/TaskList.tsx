import { Box, Text } from "ink";
import { TaskState, TodoItem } from "../schema.js";

const STATUS_ICON: Record<TodoItem["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✔",
};

const STATUS_COLOR: Record<TodoItem["status"], string> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
};

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

export function TaskList({ state }: { state: TaskState }) {
  const done = state.todos.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Session: </Text>
        <Text color="cyan">{state.sessionId}</Text>
        {state.cwd ? <Text dimColor> ({state.cwd})</Text> : null}
      </Box>

      <Box marginBottom={1}>
        <ProgressBar done={done} total={state.todos.length} />
      </Box>

      {state.todos.length === 0 ? (
        <Text dimColor>目前沒有 task。</Text>
      ) : (
        <Box flexDirection="column">
          {state.todos.map((todo, i) => {
            const label = todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content;
            return (
              <Text key={`${i}-${todo.content}`} color={STATUS_COLOR[todo.status]}>
                {STATUS_ICON[todo.status]} {label}
              </Text>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>最後更新：{new Date(state.updatedAt).toLocaleTimeString()} — 按 q 離開</Text>
      </Box>
    </Box>
  );
}
