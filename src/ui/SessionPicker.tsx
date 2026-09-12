import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export function SessionPicker({
  sessionIds,
  onSelect,
}: {
  sessionIds: string[];
  onSelect: (sessionId: string) => void;
}) {
  const items = sessionIds.map((id) => ({ label: id, value: id }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>偵測到多個 Claude Code session，請選一個要觀看的：</Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
    </Box>
  );
}
