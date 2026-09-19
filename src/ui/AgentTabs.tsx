import { Box, Text } from "ink";
import type { TabAgent } from "../agent.js";
import { formatTabLabel, type TabSummary } from "../agent-tabs.js";

export function AgentTabs({ tabs, active }: { tabs: TabSummary[]; active: TabAgent }) {
  return (
    <Box marginBottom={1}>
      {tabs.map((tab) => {
        const selected = tab.agent === active;
        return (
          <Box key={tab.agent} marginRight={1}>
            <Text
              bold={selected}
              inverse={selected}
              color={tab.attention ? "red" : undefined}
              dimColor={!selected && !tab.supported}
            >
              {` ${formatTabLabel(tab)} `}
            </Text>
          </Box>
        );
      })}
      <Text dimColor> Tab 切換</Text>
    </Box>
  );
}
