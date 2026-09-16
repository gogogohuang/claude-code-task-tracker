import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { SESSION_CACHE_NOT_CONTEXT_NOTE } from "../session-cache-scope.js";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 8;

export function CachePanel({ lines, shortId }: { lines: string[]; shortId?: string }) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const pageSize = pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS);
  const start = clampScrollOffset(offset, lines.length, pageSize);
  const visible = visibleSlice(lines, start, pageSize);
  const hiddenBelow = Math.max(0, lines.length - start - visible.length);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOffset((currentOffset) => clampScrollOffset(currentOffset, lines.length, pageSize));
  }, [lines.length, pageSize]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset + 1, lines.length, pageSize));
      }
      if (input === "k" || key.upArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset - 1, lines.length, pageSize));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Session 暫存 · {shortId ?? "—"}</Text>
      </Box>
      <Text dimColor>{SESSION_CACHE_NOT_CONTEXT_NOTE}</Text>
      <Box marginTop={1} flexDirection="column">
        {start > 0 ? <Text dimColor>↑ 還有 {start} 行</Text> : null}
        {visible.map((line, index) => (
          <Text key={`${start + index}-${line.slice(0, 24)}`} wrap="truncate-end">
            {line.length === 0 ? " " : line}
          </Text>
        ))}
        {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 行</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ 捲動 — 按 b 回任務畫面</Text>
      </Box>
    </Box>
  );
}
