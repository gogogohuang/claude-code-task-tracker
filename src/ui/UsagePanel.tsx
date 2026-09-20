import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 6;

export function UsagePanel({
  header,
  lines,
  emptyHint,
}: {
  header: string;
  lines: string[];
  emptyHint: string;
}) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const displayLines = lines.length > 0 ? lines : [emptyHint];
  const pageSize = pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS);
  const start = clampScrollOffset(offset, displayLines.length, pageSize);
  const visible = visibleSlice(displayLines, start, pageSize);
  const hiddenBelow = Math.max(0, displayLines.length - start - visible.length);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOffset((currentOffset) => clampScrollOffset(currentOffset, displayLines.length, pageSize));
  }, [displayLines.length, pageSize]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset + 1, displayLines.length, pageSize));
      }
      if (input === "k" || key.upArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset - 1, displayLines.length, pageSize));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{header}</Text>
      </Box>
      <Box flexDirection="column">
        {start > 0 ? <Text dimColor>↑ 還有 {start} 行</Text> : null}
        {visible.map((line, index) => (
          <Text key={`${start + index}-${line.slice(0, 24)}`} wrap="truncate-end">
            {line}
          </Text>
        ))}
        {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 行</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>beta：占比仍在調整，數字僅供參考 · 累計新增工作量（不含 cache 讀取；Claude 不含子 agent）· ↑↓ 捲動 — 按 b 回上一頁</Text>
      </Box>
    </Box>
  );
}
