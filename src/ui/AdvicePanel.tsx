import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { AdviceProjectGroup } from "../usage/advice-groups.js";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 6;

interface AdviceRow {
  project: string;
  sessionId: string;
  shortId: string;
  isCurrent: boolean;
  activitySummary: string | undefined;
  kind: string;
  message: string;
}

function flattenRows(groups: AdviceProjectGroup[]): AdviceRow[] {
  return groups.flatMap((group) =>
    group.sessions.flatMap((session) =>
      session.advice.map((advice) => ({
        project: group.label,
        sessionId: session.sessionId,
        shortId: session.shortId,
        isCurrent: session.isCurrent,
        activitySummary: session.activitySummary,
        kind: advice.kind,
        message: advice.message,
      })),
    ),
  );
}

export function AdvicePanel({ groups }: { groups: AdviceProjectGroup[] }) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const rows = flattenRows(groups);
  const pageSize = pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS);
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

  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>目前沒有用量建議。</Text>
        <Box marginTop={1}>
          <Text dimColor>按 b 回上一頁</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>用量建議</Text>
      </Box>
      {start > 0 ? <Text dimColor>↑ 還有 {start} 則</Text> : null}
      {visible.map((row, index) => (
        <Box key={`${row.sessionId}-${row.kind}-${index}`} flexDirection="column" marginBottom={1}>
          <Text dimColor>
            {row.project} · {row.shortId}
            {row.isCurrent ? " (目前)" : ""}
            {row.activitySummary ? ` · ${row.activitySummary}` : ""}
          </Text>
          <Text color="yellow">⚠ {row.message}</Text>
        </Box>
      ))}
      {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 則</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>↑↓ 捲動 — 按 b 回上一頁</Text>
      </Box>
    </Box>
  );
}
