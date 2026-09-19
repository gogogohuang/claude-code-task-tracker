import { ParsedEvent, TailState } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 輸出可能是字串，或 `[{ type: "input_text", text }]` 陣列；只算 text 字元數。 */
function outputTextLength(output: unknown): number {
  if (typeof output === "string") return output.length;
  if (!Array.isArray(output)) return 0;
  let total = 0;
  for (const block of output) {
    if (isRecord(block) && typeof block.text === "string") total += block.text.length;
  }
  return total;
}

/**
 * 解析 Codex rollout jsonl 的新內容，介面與 parseNewContent 相同（bytesRead 必須是 fs 層實際讀到的位元組數）。
 *
 * usage 對應：cacheRead = cached_input_tokens；cacheCreation = input_tokens − cached_input_tokens
 * （Codex 沒有 cache 寫入，「沒命中的部分」是最接近的替代）；input 固定 0，所以佔用量 = input_tokens。
 * messageId 用累計的 total_tokens，讓重複的 token_count 行在 accumulate 被去重。
 */
export function parseCodexRollout(
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

    const payload = parsed.payload;
    if (!isRecord(payload)) continue;
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;

    if (parsed.type === "response_item") {
      if (
        (payload.type === "custom_tool_call" || payload.type === "function_call") &&
        typeof payload.call_id === "string" &&
        typeof payload.name === "string"
      ) {
        toolUseNameById.set(payload.call_id, { name: payload.name });
        continue;
      }
      if (payload.type === "custom_tool_call_output" || payload.type === "function_call_output") {
        const toolUseId = typeof payload.call_id === "string" ? payload.call_id : undefined;
        const ref = toolUseId ? toolUseNameById.get(toolUseId) : undefined;
        events.push({
          messageId: undefined,
          isSidechain: false,
          timestamp,
          usage: undefined,
          toolResultChars: { toolName: ref?.name, chars: outputTextLength(payload.output), toolUseId },
        });
      }
      continue;
    }

    if (parsed.type === "event_msg" && payload.type === "token_count") {
      const info = payload.info;
      if (!isRecord(info)) continue;
      const last = info.last_token_usage;
      if (!isRecord(last)) continue;
      const total = info.total_token_usage;
      const totalTokens = isRecord(total) && typeof total.total_tokens === "number" ? total.total_tokens : undefined;
      const input = numberOr0(last.input_tokens);
      const cached = numberOr0(last.cached_input_tokens);
      const contextWindow = typeof info.model_context_window === "number" ? info.model_context_window : undefined;
      events.push({
        messageId: totalTokens !== undefined ? `total:${totalTokens}` : undefined,
        isSidechain: false,
        timestamp,
        usage: {
          input: 0,
          cacheRead: cached,
          cacheCreation: Math.max(0, input - cached),
          output: numberOr0(last.output_tokens),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        },
        toolResultChars: undefined,
      });
    }
  }

  return {
    events,
    state: { offset: state.offset + bytesRead, toolUseNameById, danglingLine },
  };
}
