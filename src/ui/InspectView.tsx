import { Box, Text } from "ink";
import { formatByteSize } from "../inspect/heat.js";
import { previewDisplayLines } from "../inspect/preview-display.js";
import { Preview } from "../inspect/preview.js";
import { InspectEntry, InspectModel, InspectSection, InspectStatus } from "../inspect/types.js";
import { visibleSlice } from "./scroll-window.js";

const STATUS_SUFFIX: Partial<Record<InspectStatus, string>> = {
  missing: "未找到",
  external: "外部，可能尚未核准",
  excluded: "已排除",
  "skipped-too-large": "Claude 會略過",
  disabled: "未載入",
};

const SECTION_TITLE: Record<InspectSection, string> = {
  launch: "啟動時載入",
  onDemand: "按需才載入",
  outOfSession: "此目錄不會載入",
};

export type InspectUiView = "list" | "preview";

function EntryRow({
  entry,
  selected,
  showPath,
}: {
  entry: InspectEntry;
  selected: boolean;
  showPath: boolean;
}) {
  const suffix = STATUS_SUFFIX[entry.status];
  const sizeLabel = entry.byteSize !== undefined ? formatByteSize(entry.byteSize) : undefined;
  return (
    <Text wrap="truncate-end" color={selected ? "cyan" : undefined}>
      {selected ? "› " : "  "}
      {entry.label}
      {sizeLabel ? <Text dimColor>{`  ${sizeLabel}`}</Text> : null}
      {suffix ? `  ${suffix}` : ""}
      {showPath ? <Text dimColor>{`  ${entry.absolutePath}`}</Text> : null}
      {entry.detail ? <Text dimColor>{`  ${entry.detail}`}</Text> : null}
      {entry.trustNote ? <Text dimColor>{`  ${entry.trustNote}`}</Text> : null}
    </Text>
  );
}

function ListBody({
  model,
  selectedIndex,
  listOffset,
  listPageSize,
}: {
  model: InspectModel;
  selectedIndex: number;
  listOffset: number;
  listPageSize: number;
}) {
  const start = listOffset;
  const visible = visibleSlice(model.entries, listOffset, listPageSize);
  const hiddenBelow = Math.max(0, model.entries.length - start - visible.length);
  let lastSection: InspectSection | undefined;

  return (
    <Box flexDirection="column">
      {start > 0 ? <Text dimColor>↑ 還有 {start} 項</Text> : null}
      {visible.map((entry, visibleIndex) => {
        const index = start + visibleIndex;
        const showHeader = entry.section !== lastSection;
        lastSection = entry.section;
        return (
          <Box key={entry.id} flexDirection="column">
            {showHeader ? <Text bold wrap="truncate-end">{SECTION_TITLE[entry.section]}</Text> : null}
            <EntryRow
              entry={entry}
              selected={index === selectedIndex}
              showPath={entry.section !== "launch"}
            />
          </Box>
        );
      })}
      {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 項</Text> : null}
      {model.entries.length === 0 ? <Text dimColor>沒有可檢視的項目</Text> : null}
    </Box>
  );
}

export function InspectView({
  model,
  view,
  selectedIndex,
  listOffset,
  listPageSize,
  preview,
  previewScroll,
  previewPageSize,
  columns,
}: {
  model: InspectModel;
  view: InspectUiView;
  selectedIndex: number;
  listOffset: number;
  listPageSize: number;
  preview: Preview;
  previewScroll: number;
  previewPageSize: number;
  columns: number;
}) {
  const selected = model.entries[selectedIndex];

  if (view === "preview") {
    const lines = previewDisplayLines(preview).slice(
      previewScroll,
      previewScroll + previewPageSize,
    );
    const total = previewDisplayLines(preview).length;
    const hiddenBelow = Math.max(0, total - previewScroll - lines.length);

    return (
      <Box flexDirection="column" width={columns}>
        <Text bold wrap="truncate-end">
          預覽 · {selected?.label ?? "未找到"}
        </Text>
        {selected ? (
          <Text dimColor wrap="truncate-end">
            {selected.absolutePath}
          </Text>
        ) : null}
        <Box flexDirection="column" width={columns} marginTop={1}>
          {previewScroll > 0 ? <Text dimColor>↑ 還有 {previewScroll} 行</Text> : null}
          {lines.map((line, index) => (
            <Text key={`${previewScroll + index}`} wrap="truncate-end">
              {line.length > 0 ? line : " "}
            </Text>
          ))}
          {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 行</Text> : null}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ 捲動 — 按 b 回清單 — 按 q 離開</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns}>
      <Text bold wrap="truncate-end">
        Inspect {model.cwd}
      </Text>
      {model.headerNotes.map((note) => (
        <Text key={note} dimColor wrap="truncate-end">
          {note}
        </Text>
      ))}
      {model.warnings.map((warning) => (
        <Text key={warning} color="yellow" wrap="truncate-end">
          {warning}
        </Text>
      ))}
      <Box flexDirection="column" width={columns} marginTop={1}>
        <ListBody
          model={model}
          selectedIndex={selectedIndex}
          listOffset={listOffset}
          listPageSize={listPageSize}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ 選擇 — Enter 預覽 — 按 q 離開</Text>
      </Box>
    </Box>
  );
}
