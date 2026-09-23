import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { formatRelativeAge } from "../format-relative-age.js";
import { formatTokenCount } from "../usage-overview.js";
import { adviceOverviewLine, AdviceGroup, AdviceRow, groupAdvice } from "../usage/advice-groups.js";
import { Advice, AdviceKind } from "../usage/types.js";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 7;
// 每則 advice 實際佔用的終端機行數：summary 行 + action 行 + 相對時間行 + marginBottom={1} 留白，
// 捲動換算頁面大小時要除掉這個係數，不然每則 advice 只當 1 行算，六則以上就會塞爆終端機。
// 分組標題行沒有另外計入，捲動頁面大小因此略為保守（不會塞爆，最多少顯示一兩行）。
const ROWS_PER_ADVICE = 4;

/** 攤平成一列一列渲染用的資料：只有每組第一列帶 groupKind/groupTotalCount，用來畫分組標題。 */
interface DisplayRow extends AdviceRow {
  groupKind?: AdviceKind;
  groupTotalCount?: number;
}

function flattenGroups(groups: AdviceGroup[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  for (const group of groups) {
    group.rows.forEach((row, index) => {
      out.push(index === 0 ? { ...row, groupKind: group.kind, groupTotalCount: group.totalCount } : row);
    });
  }
  return out;
}

function mergeSuffix(row: AdviceRow): string {
  if (row.count <= 1) return "";
  const tokenPart = row.estTokensSum !== undefined ? `，累積約 ${formatTokenCount(row.estTokensSum)} token` : "";
  return `（×${row.count} 次${tokenPart}）`;
}

export function AdvicePanel({
  advice,
  shortId,
  emptyHint,
  uncoveredHint,
}: {
  advice: Advice[];
  shortId?: string;
  emptyHint?: string;
  uncoveredHint?: string;
}) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const groups = groupAdvice(advice);
  const rows = flattenGroups(groups);
  const maxDetail = Math.max(0, ...advice.map((item) => item.detailLines?.length ?? 0));
  const rowsPerAdvice = ROWS_PER_ADVICE + maxDetail;
  const pageSize = Math.max(1, Math.floor(pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS) / rowsPerAdvice));
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

  if (advice.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{emptyHint ?? "目前沒有用量建議。"}</Text>
        {uncoveredHint ? <Text dimColor>{uncoveredHint}</Text> : null}
        <Box marginTop={1}>
          <Text dimColor>按 b 回上一頁</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text bold>用量建議 · {shortId}</Text>
        <Text dimColor>{adviceOverviewLine(groups)}</Text>
      </Box>
      {start > 0 ? <Text dimColor>↑ 還有 {start} 則</Text> : null}
      {visible.map((row, index) => (
        <Box key={`${row.kind}-${row.at}-${index}`} flexDirection="column">
          {row.groupKind ? (
            <Box marginTop={index === 0 ? 0 : 1}>
              <Text bold dimColor>
                {row.groupKind} · {row.groupTotalCount} 則
              </Text>
            </Box>
          ) : null}
          <Box flexDirection="column" marginBottom={1}>
            <Text color={row.severity === "critical" ? "red" : "yellow"} bold={row.severity === "critical"}>
              {row.severity === "critical" ? "✗" : "⚠"} {row.summary}
              {mergeSuffix(row)}
            </Text>
            <Text dimColor>{"  "}→ {row.action}</Text>
            {row.detailLines?.map((line, lineIndex) => (
              <Text key={`${line}-${lineIndex}`} dimColor>
                {"  "}· {line}
              </Text>
            ))}
            <Text dimColor>{formatRelativeAge(row.at)}</Text>
          </Box>
        </Box>
      ))}
      {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 則</Text> : null}
      {uncoveredHint ? <Text dimColor>{uncoveredHint}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>↑↓ 捲動 — 按 c 複製 — 按 b 回上一頁</Text>
      </Box>
    </Box>
  );
}
