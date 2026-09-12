import { Box, Text } from "ink";
import { Preview } from "../inspect/preview.js";
import { InspectModel, InspectStatus } from "../inspect/types.js";

const STATUS_SUFFIX: Partial<Record<InspectStatus, string>> = {
  missing: "未找到",
  external: "外部，可能尚未核准",
  excluded: "已排除",
  "skipped-too-large": "Claude 會略過",
  disabled: "未載入",
};

function previewLines(preview: Preview): string[] {
  if (!preview.text) return [preview.notice ?? ""];
  const lines = preview.text.split("\n");
  if (preview.loadBoundaryLine === undefined) return lines;
  return [
    ...lines.slice(0, preview.loadBoundaryLine),
    "──── 啟動時不載入 ────",
    ...lines.slice(preview.loadBoundaryLine),
  ];
}

function EntryList({
  model,
  selectedIndex,
}: {
  model: InspectModel;
  selectedIndex: number;
}) {
  const launch = model.entries.filter((entry) => entry.section === "launch");
  const onDemand = model.entries.filter((entry) => entry.section === "onDemand");

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">啟動時載入</Text>
      {launch.map((entry) => {
        const index = model.entries.indexOf(entry);
        const suffix = STATUS_SUFFIX[entry.status];
        return (
          <Text key={entry.id} wrap="truncate-end" color={index === selectedIndex ? "cyan" : undefined}>
            {index === selectedIndex ? "› " : "  "}
            {entry.label}
            {suffix ? `  ${suffix}` : ""}
            {entry.detail ? <Text dimColor>{`  ${entry.detail}`}</Text> : null}
            {entry.trustNote ? <Text dimColor>{`  ${entry.trustNote}`}</Text> : null}
          </Text>
        );
      })}
      {onDemand.length > 0 ? <Text bold wrap="truncate-end">按需才載入</Text> : null}
      {onDemand.map((entry) => {
        const index = model.entries.indexOf(entry);
        return (
          <Text key={entry.id} wrap="truncate-end" color={index === selectedIndex ? "cyan" : undefined}>
            {index === selectedIndex ? "› " : "  "}
            {entry.label}
            <Text dimColor>{`  ${entry.absolutePath}`}</Text>
            {entry.detail ? <Text dimColor>{`  ${entry.detail}`}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}

export function InspectView({
  model,
  selectedIndex,
  preview,
  previewScroll,
  columns,
}: {
  model: InspectModel;
  selectedIndex: number;
  preview: Preview;
  previewScroll: number;
  columns: number;
}) {
  const lines = previewLines(preview).slice(previewScroll, previewScroll + 20);

  return (
    <Box flexDirection="column" width={columns}>
      <Text bold wrap="truncate-end">Inspect {model.cwd}</Text>
      {model.headerNotes.map((note) => (
        <Text key={note} dimColor wrap="truncate-end">{note}</Text>
      ))}
      {model.warnings.map((warning) => (
        <Text key={warning} color="yellow" wrap="truncate-end">{warning}</Text>
      ))}
      <Box flexDirection="column" width={columns} marginTop={1}>
        <EntryList model={model} selectedIndex={selectedIndex} />
      </Box>
      <Box flexDirection="column" width={columns} marginTop={1}>
        {lines.map((line, index) => (
          <Text key={`${previewScroll + index}`} wrap="truncate-end">{line.length > 0 ? line : " "}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>j/k 選擇   [ ] 捲動   q 離開</Text>
      </Box>
    </Box>
  );
}
