import { Box, Text, useInput, useStdin } from "ink";
import { activityLineLabel } from "../context-snapshot.js";
import { classifyPresence, presenceColor, presenceLabelPrefix } from "../session-presence.js";
import { shortSessionId } from "../session-preference.js";
import type { SplitFocus } from "../split-layout.js";
import { visibleSplitTaskRows } from "../split-tasks.js";
import { TaskState } from "../schema.js";
import { taskRows } from "./task-rows.js";
import { clampScrollOffset } from "./scroll-window.js";

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✔",
  deleted: "✖",
};

function SplitPane({
  state,
  focused,
  pinned,
  gauge,
  scrollOffset,
}: {
  state: TaskState | null;
  focused: boolean;
  pinned: boolean;
  gauge?: { bar: string; color: "green" | "yellow" | "red" };
  scrollOffset: number;
}) {
  if (!state) {
    return (
      <Box flexDirection="column" flexGrow={1} width="50%" paddingX={1}>
        <Text dimColor>{focused ? "▸ " : "  "}讀取中…</Text>
      </Box>
    );
  }
  const presence = classifyPresence({
    activity: state.activity,
    updatedAt: state.updatedAt,
  });
  const color = presenceColor(presence);
  const rows = visibleSplitTaskRows(taskRows(state), scrollOffset);
  const marker = focused ? "▸ " : "  ";
  const pin = focused && pinned ? " · 已釘選" : "";

  return (
    <Box flexDirection="column" flexGrow={1} width="50%" paddingX={1}>
      <Text bold color={color}>
        {marker}
        {presenceLabelPrefix(presence)}
        {shortSessionId(state.sessionId)}
        {pin}
      </Text>
      <Text>{state.activity ? activityLineLabel(state.activity) : "無活動"}</Text>
      {gauge ? <Text color={gauge.color}>{gauge.bar}</Text> : <Text dimColor>context —</Text>}
      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 ? (
          <Text dimColor>沒有 task</Text>
        ) : (
          rows.map((row) => (
            <Text key={row.key}>
              {STATUS_ICON[row.status] ?? "○"} {row.label}
              {row.suffix ?? ""}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

export function SplitView({
  left,
  right,
  focus,
  pinned,
  leftGauge,
  rightGauge,
  leftScroll,
  rightScroll,
  onScrollFocus,
}: {
  left: TaskState | null;
  right: TaskState | null;
  focus: SplitFocus;
  pinned: boolean;
  leftGauge?: { bar: string; color: "green" | "yellow" | "red" };
  rightGauge?: { bar: string; color: "green" | "yellow" | "red" };
  leftScroll: number;
  rightScroll: number;
  onScrollFocus: (delta: number) => void;
}) {
  const { isRawModeSupported } = useStdin();

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) onScrollFocus(1);
      if (input === "k" || key.upArrow) onScrollFocus(-1);
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <SplitPane
          state={left}
          focused={focus === "left"}
          pinned={pinned}
          gauge={leftGauge}
          scrollOffset={leftScroll}
        />
        <Text dimColor>│</Text>
        <SplitPane
          state={right}
          focused={focus === "right"}
          pinned={pinned}
          gauge={rightGauge}
          scrollOffset={rightScroll}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[ ] 切欄 · j/k 捲 task · v/b 退出</Text>
      </Box>
    </Box>
  );
}

/** 供 App 計算捲動上限 */
export function clampSplitScroll(offset: number, rowCount: number, pageSize: number): number {
  return clampScrollOffset(offset, rowCount, pageSize);
}
