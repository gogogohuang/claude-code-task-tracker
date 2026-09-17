import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { activityLineLabel } from "../context-snapshot.js";
import { pickNextTask } from "../next-task.js";
import { Activity, TaskState } from "../schema.js";
import { classifyPresence, presenceColor } from "../session-presence.js";
import { phaseProgress } from "../workflow/phase-progress.js";
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

function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const width = 24;
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <Text>
      {label ? <Text dimColor>{label} </Text> : null}
      <Text color="green">{bar}</Text> {pct}% ({done}/{total})
    </Text>
  );
}

function ActivityLine({ activity }: { activity: Activity }) {
  const time = new Date(activity.at).toLocaleTimeString();
  const label = activityLineLabel(activity);
  if (activity.phase === "running") {
    return (
      <Text color="yellow">
        {label}
        <Text dimColor> ({time} 開始)</Text>
      </Text>
    );
  }
  return (
    <Text dimColor>
      {label}
      <Text dimColor> ({time} 完成)</Text>
    </Text>
  );
}

export function TaskList({
  state,
  current,
  contextSnapshot,
  toolInventorySummary,
  stuckLabel,
  endedSummary,
  pinned,
}: {
  state: TaskState;
  current?: boolean;
  contextSnapshot?: {
    occupiedLine: string;
    breakdownLine?: string;
    gauge?: { bar: string; color: "green" | "yellow" | "red" };
  };
  toolInventorySummary?: string;
  stuckLabel?: string;
  endedSummary?: string;
  pinned?: boolean;
}) {
  const { isRawModeSupported } = useStdin();
  const rows = taskRows(state);
  const done = rows.filter((r) => r.status === "completed").length;
  const phases = phaseProgress(state.workflow);
  const next = pickNextTask(state);
  const presence = classifyPresence({
    activity: state.activity,
    updatedAt: state.updatedAt,
  });
  const headerColor = presenceColor(presence);
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const snapshotExtraRows =
    (contextSnapshot
      ? 2 + (contextSnapshot.breakdownLine ? 1 : 0) + (contextSnapshot.gauge ? 1 : 0)
      : 0) +
    (toolInventorySummary ? 1 : 0) +
    (stuckLabel ? 1 : 0) +
    (endedSummary ? 1 : 0) +
    (phases ? 1 : 0) +
    (next ? 1 : 0);
  const pageSize = pageSizeFromTerminal(termRows, LIST_CHROME_ROWS + snapshotExtraRows);
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
        <Text bold color={headerColor}>
          Session:{" "}
        </Text>
        <Text color={headerColor}>{state.sessionId}</Text>
        {current ? <Text color="green">  目前</Text> : null}
        {pinned ? <Text color="cyan">  已釘選</Text> : null}
        {state.cwd ? <Text dimColor> ({state.cwd})</Text> : null}
      </Box>

      {endedSummary ? (
        <Box marginBottom={1}>
          <Text dimColor>{endedSummary}</Text>
        </Box>
      ) : null}

      {contextSnapshot ? (
        <Box flexDirection="column" marginBottom={1}>
          {contextSnapshot.gauge ? (
            <Text color={contextSnapshot.gauge.color}>{contextSnapshot.gauge.bar}</Text>
          ) : null}
          <Text>{contextSnapshot.occupiedLine}</Text>
          {contextSnapshot.breakdownLine ? <Text dimColor>{contextSnapshot.breakdownLine}</Text> : null}
        </Box>
      ) : null}

      {state.activity ? (
        <Box marginBottom={1} flexDirection="column">
          <ActivityLine activity={state.activity} />
          {stuckLabel ? <Text color="yellow">⚠ {stuckLabel}</Text> : null}
          {next ? (
            <Text color="cyan" dimColor>
              下一個：{next.label}
            </Text>
          ) : null}
        </Box>
      ) : next ? (
        <Box marginBottom={1}>
          <Text color="cyan" dimColor>
            下一個：{next.label}
          </Text>
        </Box>
      ) : null}

      {toolInventorySummary ? (
        <Box marginBottom={1}>
          <Text dimColor>
            {toolInventorySummary} — 按 t 查看
          </Text>
        </Box>
      ) : null}

      {phases || rows.length > 0 ? (
        <>
          <Box marginBottom={1} flexDirection="column">
            {phases ? <ProgressBar done={phases.done} total={phases.total} label="Phase" /> : null}
            {rows.length > 0 ? <ProgressBar done={done} total={rows.length} /> : null}
          </Box>
          {rows.length > 0 ? (
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
          ) : null}
        </>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          最後更新：{new Date(state.updatedAt).toLocaleTimeString()} — ↑↓ 捲動 — 按 s 暫存 — 按 a 用量 — 按 t 工具 — 按 h 活動紀錄 — 按 b 回列表 — 按 d 清除暫存 — 按 q 離開
        </Text>
      </Box>
    </Box>
  );
}
