import { ParsedEvent, TailState } from "./types.js";
import { detailToolLabel } from "./tool-inventory.js";

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

function extractToolPath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const filePath = input.file_path;
  if (typeof filePath === "string" && filePath.trim()) return filePath;
  const path = input.path;
  if (typeof path === "string" && path.trim()) return path;
  return undefined;
}

function extractAgentDispatch(input: unknown): { subagentType?: string; description?: string } {
  if (!isRecord(input)) return {};
  const subagentType = typeof input.subagent_type === "string" ? input.subagent_type : undefined;
  const description = typeof input.description === "string" ? input.description : undefined;
  return { subagentType, description };
}

function extractUsableUserText(content: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof content === "string") {
    raw = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!isRecord(block) || block.type !== "text") continue;
      if (typeof block.text === "string") parts.push(block.text);
    }
    if (parts.length === 0) return undefined;
    raw = parts.join("");
  } else {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("<local-command-caveat>")) return undefined;
  return trimmed;
}

function identityEvent(
  isSidechain: boolean,
  timestamp: string | undefined,
  extra: { title?: string; userText?: string },
): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain,
    timestamp,
    usage: undefined,
    toolResultChars: undefined,
    ...extra,
  };
}

/**
 * bytesRead 必須是呼叫端（fs 層）實際從磁碟讀到的位元組數，不能用 chunk 重新推算。
 * chunk 是已經 decode 過的 JS 字串；如果讀取邊界剛好切在一個多位元組字元中間，
 * decode 出來的替代字元（U+FFFD）重新編碼後的位元組長度會跟磁碟上實際讀到的不一樣，
 * 用 Buffer.byteLength(chunk) 反推 offset 會讓下一次讀取位置跟磁碟真正的位置脫節、掉行。
 */
export function parseNewContent(
  chunk: string,
  state: TailState,
  bytesRead: number,
): { events: ParsedEvent[]; state: TailState } {
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

    if (parsed.type === "ai-title") {
      const aiTitle = typeof parsed.aiTitle === "string" ? parsed.aiTitle.trim() : "";
      if (aiTitle) events.push(identityEvent(isSidechain, timestamp, { title: aiTitle }));
      continue;
    }

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
            input: numberOr0(usage.input_tokens),
          },
          toolResultChars: undefined,
        });
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== "tool_use") continue;
          const path = extractToolPath(block.input);
          if (typeof block.id === "string" && typeof block.name === "string") {
            toolUseNameById.set(block.id, { name: block.name, path });
          }
          if (typeof block.name === "string") {
            const agentDispatch =
              block.name === "Agent" && typeof block.id === "string"
                ? { toolUseId: block.id, ...extractAgentDispatch(block.input) }
                : undefined;
            events.push({
              messageId: undefined,
              isSidechain,
              timestamp,
              usage: undefined,
              toolResultChars: undefined,
              toolUseName: detailToolLabel(block.name, block.input),
              toolUsePath: path,
              agentDispatch,
            });
          }
        }
      }
      continue;
    }

    if (role === "user") {
      const userText = extractUsableUserText(content);
      if (userText) events.push(identityEvent(isSidechain, timestamp, { userText }));
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== "tool_result") continue;
          const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
          const ref = toolUseId ? toolUseNameById.get(toolUseId) : undefined;
          events.push({
            messageId: undefined,
            isSidechain,
            timestamp,
            usage: undefined,
            toolResultChars: {
              toolName: ref?.name,
              chars: toolResultTextLength(block.content),
              path: ref?.path,
              toolUseId,
            },
          });
        }
      }
    }
  }

  return {
    events,
    state: {
      offset: state.offset + bytesRead,
      toolUseNameById,
      danglingLine,
    },
  };
}
