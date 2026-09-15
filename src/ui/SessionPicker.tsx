import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { SessionChoice } from "../session-preference.js";

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
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>{heading}</Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      {hint ? (
        <Box marginTop={1}>
          <Text dimColor>{hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
