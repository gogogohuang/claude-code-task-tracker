export interface ToolInventory {
  tools: Record<string, number>;
  mcpTools: Record<string, number>;
}

export function emptyToolInventory(): ToolInventory {
  return { tools: {}, mcpTools: {} };
}

/** 一次工具呼叫的時序紀錄，供 history 面板依呼叫順序回放整個 session。 */
export interface ToolCallLogEntry {
  at: string | undefined;
  toolName: string;
  path?: string;
  /** 這次呼叫做了什麼的一句話；沒有時退回只顯示 path。 */
  summary?: string;
  /** 發出這次呼叫時 context 窗口占用（input + cache read + cache create），來自該輪 assistant usage。 */
  occupiedTokens?: number;
  contextWindow?: number;
}

/** 上限：避免超長 session 讓這份 log 無限成長，超過時丟最舊的、留最近呼叫。 */
export const TOOL_CALL_LOG_LIMIT = 1000;

export function appendToolCallLog(log: ToolCallLogEntry[], entry: ToolCallLogEntry): ToolCallLogEntry[] {
  const next = [...log, entry];
  if (next.length <= TOOL_CALL_LOG_LIMIT) return next;
  return next.slice(next.length - TOOL_CALL_LOG_LIMIT);
}

export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const rest = name.slice("mcp__".length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return undefined;
  const server = rest.slice(0, idx);
  const tool = rest.slice(idx + 2);
  if (!server || !tool) return undefined;
  return { server, tool };
}

function pickString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 組出面板用的細節標籤；Skill／Agent 會帶上 input 細節，其餘回工具本名。 */
export function detailToolLabel(toolName: string, toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) return toolName;
  const record = toolInput as Record<string, unknown>;
  if (toolName === "Skill") {
    const skill = pickString(record, "skill") ?? pickString(record, "skillName");
    return skill ? `Skill · ${skill}` : toolName;
  }
  if (toolName === "Agent") {
    const type = pickString(record, "subagent_type");
    return type ? `Agent · ${type}` : toolName;
  }
  return toolName;
}

function bump(counts: Record<string, number>, key: string): Record<string, number> {
  return { ...counts, [key]: (counts[key] ?? 0) + 1 };
}

export function recordToolUse(inventory: ToolInventory, toolName: string): ToolInventory {
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    return {
      tools: inventory.tools,
      mcpTools: bump(inventory.mcpTools, `${mcp.server}/${mcp.tool}`),
    };
  }
  return {
    tools: bump(inventory.tools, toolName),
    mcpTools: inventory.mcpTools,
  };
}

function uniqueMcpServers(inventory: ToolInventory): number {
  const servers = new Set<string>();
  for (const key of Object.keys(inventory.mcpTools)) {
    const slash = key.indexOf("/");
    if (slash > 0) servers.add(key.slice(0, slash));
  }
  return servers.size;
}

export function formatToolInventorySummary(inventory: ToolInventory): string | undefined {
  const toolCount = Object.keys(inventory.tools).length;
  const mcpCount = uniqueMcpServers(inventory);
  if (toolCount === 0 && mcpCount === 0) return undefined;
  if (toolCount > 0 && mcpCount > 0) return `tools ${toolCount} · mcp ${mcpCount}`;
  if (toolCount > 0) return `tools ${toolCount}`;
  return `mcp ${mcpCount}`;
}

function sortedCountLines(counts: Record<string, number>, format: (name: string, count: number) => string): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => format(name, count));
}

export function formatToolInventoryLines(inventory: ToolInventory): string[] {
  const lines: string[] = [];
  const toolEntries = Object.keys(inventory.tools).length;
  const mcpEntries = Object.keys(inventory.mcpTools).length;
  if (toolEntries > 0) {
    lines.push("工具");
    lines.push(...sortedCountLines(inventory.tools, (name, count) => `  ${name} × ${count}`));
  }
  if (mcpEntries > 0) {
    lines.push("MCP");
    lines.push(
      ...sortedCountLines(inventory.mcpTools, (key, count) => {
        const slash = key.indexOf("/");
        const label = slash > 0 ? `${key.slice(0, slash)} / ${key.slice(slash + 1)}` : key;
        return `  ${label} × ${count}`;
      }),
    );
  }
  return lines;
}
