import { ParsedEvent, TailState } from "./types.js";

export function createTailState(): TailState {
  return { offset: 0, toolUseNameById: new Map(), danglingLine: "" };
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toolResultTextLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") total += text.length;
        continue;
      }
      total += JSON.stringify(block ?? "").length;
    }
    return total;
  }
  return JSON.stringify(content ?? "").length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseNewContent(chunk: string, state: TailState): { events: ParsedEvent[]; state: TailState } {
  const combined = state.danglingLine + chunk;
  const lines = combined.split("\n");
  const danglingLine = lines.pop() ?? "";
  const toolUseNameById = new Map(state.toolUseNameById);
  const events: ParsedEvent[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const isSidechain = parsed.isSidechain === true;
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
    const message = parsed.message;
    if (!isRecord(message)) continue;

    const role = message.role;
    const messageId = typeof message.id === "string" ? message.id : undefined;
    const content = message.content;

    if (role === "assistant") {
      const usage = message.usage;
      if (isRecord(usage)) {
        events.push({
          messageId,
          isSidechain,
          timestamp,
          usage: {
            cacheCreation: numberOr0(usage.cache_creation_input_tokens),
            cacheRead: numberOr0(usage.cache_read_input_tokens),
            output: numberOr0(usage.output_tokens),
          },
          toolResultChars: undefined,
        });
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== "tool_use") continue;
          if (typeof block.id === "string" && typeof block.name === "string") {
            toolUseNameById.set(block.id, block.name);
          }
        }
      }
      continue;
    }

    if (role === "user" && Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block.type !== "tool_result") continue;
        const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
        events.push({
          messageId: undefined,
          isSidechain,
          timestamp,
          usage: undefined,
          toolResultChars: {
            toolName: toolUseId ? toolUseNameById.get(toolUseId) : undefined,
            chars: toolResultTextLength(block.content),
          },
        });
      }
    }
  }

  return {
    events,
    state: {
      offset: state.offset + Buffer.byteLength(chunk, "utf-8"),
      toolUseNameById,
      danglingLine,
    },
  };
}
