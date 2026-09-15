import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { SessionChoice } from "../session-preference.js";
import { pageSizeFromTerminal } from "./scroll-window.js";

const PICKER_CHROME_ROWS = 6;

export function SessionPicker({
  heading,
  hint,
  items,
  onSelect,
}: {
  heading: string;
  hint?: string;
  items: SessionChoice[];
  onSelect: (value: string) => void;
}) {
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>{heading}</Text>
      </Box>
      <SelectInput
        items={items}
        limit={pageSizeFromTerminal(termRows, PICKER_CHROME_ROWS)}
        onSelect={(item) => onSelect(item.value)}
      />
      {hint ? (
        <Box marginTop={1}>
          <Text dimColor>{hint} · ↑↓ 捲動</Text>
        </Box>
      ) : null}
    </Box>
  );
}
