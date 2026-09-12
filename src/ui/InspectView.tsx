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
      <Text bold>啟動時載入</Text>
      {launch.map((entry) => {
        const index = model.entries.indexOf(entry);
        const suffix = STATUS_SUFFIX[entry.status];
        return (
          <Text key={entry.id} color={index === selectedIndex ? "cyan" : undefined}>
            {index === selectedIndex ? "› " : "  "}
            {entry.label}
            {suffix ? `  ${suffix}` : ""}
            {entry.detail ? <Text dimColor>{`  ${entry.detail}`}</Text> : null}
            {entry.trustNote ? <Text dimColor>{`  ${entry.trustNote}`}</Text> : null}
          </Text>
        );
      })}
      {onDemand.length > 0 ? <Text bold>按需才載入</Text> : null}
      {onDemand.map((entry) => {
        const index = model.entries.indexOf(entry);
        return (
          <Text key={entry.id} color={index === selectedIndex ? "cyan" : undefined}>
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
  stacked,
}: {
  model: InspectModel;
  selectedIndex: number;
  preview: Preview;
  previewScroll: number;
  stacked: boolean;
}) {
  const lines = previewLines(preview).slice(previewScroll, previewScroll + 20);
  const list = (
    <Box flexDirection="column" width={stacked ? undefined : 36}>
      <EntryList model={model} selectedIndex={selectedIndex} />
    </Box>
  );
  const pane = (
    <Box flexDirection="column" flexGrow={1}>
      {lines.map((line, index) => (
        <Text key={`${previewScroll + index}`}>{line}</Text>
      ))}
    </Box>
  );

  return (
    <Box flexDirection="column">
      <Text bold>Inspect {model.cwd}</Text>
      {model.headerNotes.map((note) => (
        <Text key={note} dimColor>{note}</Text>
      ))}
      {model.warnings.map((warning) => (
        <Text key={warning} color="yellow">{warning}</Text>
      ))}
      <Box flexDirection={stacked ? "column" : "row"} marginTop={1}>
        {list}
        {pane}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>j/k 選擇   [ ] 捲動   q 離開</Text>
      </Box>
    </Box>
  );
}
