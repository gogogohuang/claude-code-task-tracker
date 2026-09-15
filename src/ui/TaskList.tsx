import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { Activity, TaskState } from "../schema.js";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";
import { RowStatus, taskRows } from "./task-rows.js";

const STATUS_ICON: Record<RowStatus, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✔",
  deleted: "✖",
};

const STATUS_COLOR: Record<RowStatus, string> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  deleted: "gray",
};

const LIST_CHROME_ROWS = 10;

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

export function TaskList({ state, current }: { state: TaskState; current?: boolean }) {
  const { isRawModeSupported } = useStdin();
  const rows = taskRows(state);
  const done = rows.filter((r) => r.status === "completed").length;
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const pageSize = pageSizeFromTerminal(termRows, LIST_CHROME_ROWS);
  const start = clampScrollOffset(offset, rows.length, pageSize);
  const visible = visibleSlice(rows, start, pageSize);
  const hiddenBelow = Math.max(0, rows.length - start - visible.length);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOffset((currentOffset) => clampScrollOffset(currentOffset, rows.length, pageSize));
  }, [rows.length, pageSize]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset + 1, rows.length, pageSize));
      }
      if (input === "k" || key.upArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset - 1, rows.length, pageSize));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Session: </Text>
        <Text color="cyan">{state.sessionId}</Text>
        {current ? <Text color="green">  目前</Text> : null}
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
          {start > 0 ? <Text dimColor>↑ 還有 {start} 行</Text> : null}
          {visible.map((row) => (
            <Text key={row.key} color={STATUS_COLOR[row.status]}>
              {STATUS_ICON[row.status]} {row.label}
              {row.suffix ? <Text dimColor>{row.suffix}</Text> : null}
            </Text>
          ))}
          {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 行</Text> : null}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          最後更新：{new Date(state.updatedAt).toLocaleTimeString()} — ↑↓ 捲動 — 按 b 回列表 — 按 q 離開
        </Text>
      </Box>
    </Box>
  );
}
