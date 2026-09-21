import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { activityLineLabel, contextOccupancyPct } from "../context-snapshot.js";
import type { TimelineEntry } from "../activity-timeline.js";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 6;

export function HistoryPanel({
  entries,
  shortId,
}: {
  entries: TimelineEntry[];
  shortId?: string;
}) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const pageSize = pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS);
  const start = clampScrollOffset(offset, entries.length, pageSize);
  const visible = visibleSlice(entries, start, pageSize);
  const hiddenBelow = Math.max(0, entries.length - start - visible.length);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOffset((currentOffset) => clampScrollOffset(currentOffset, entries.length, pageSize));
  }, [entries.length, pageSize]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset + 1, entries.length, pageSize));
      }
      if (input === "k" || key.upArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset - 1, entries.length, pageSize));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  if (entries.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>這個 session 還沒有工具呼叫紀錄。</Text>
        <Box marginTop={1}>
          <Text dimColor>按 b 回上一頁</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>活動紀錄 · {shortId}</Text>
        <Text dimColor> （共 {entries.length} 筆，依呼叫順序）</Text>
      </Box>
      {start > 0 ? <Text dimColor>↑ 還有 {start} 行</Text> : null}
      {visible.map((entry, index) => {
        const time = new Date(entry.at).toLocaleTimeString();
        return (
          <Text key={`${entry.at}-${entry.phase}-${entry.toolName}-${start + index}`} wrap="truncate-end">
            <Text dimColor>{time} </Text>
            {activityLineLabel(entry)}
            {entry.occupiedTokens !== undefined ? (
              <Text dimColor>
                {" "}· ctx {entry.occupiedTokens.toLocaleString("en-US")}（{contextOccupancyPct(entry.occupiedTokens, entry.contextWindow)}%）
              </Text>
            ) : null}
          </Text>
        );
      })}
      {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 行</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>↑↓ 捲動 — 按 b 回上一頁</Text>
      </Box>
    </Box>
  );
}
