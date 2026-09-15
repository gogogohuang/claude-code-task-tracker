import assert from "node:assert/strict";
import test from "node:test";
import { createTailState, parseNewContent } from "./tail-transcript.js";

function assistantLine(opts: {
  id: string;
  cacheCreation: number;
  cacheRead?: number;
  output?: number;
  isSidechain?: boolean;
  timestamp?: string;
  content?: unknown[];
}): string {
  return JSON.stringify({
    isSidechain: opts.isSidechain ?? false,
    timestamp: opts.timestamp ?? "2026-09-15T00:00:00.000Z",
    message: {
      role: "assistant",
      id: opts.id,
      usage: {
        cache_creation_input_tokens: opts.cacheCreation,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        output_tokens: opts.output ?? 0,
      },
      content: opts.content ?? [{ type: "text", text: "hi" }],
    },
  });
}

function toolResultLine(opts: { toolUseId: string; text: string; isSidechain?: boolean; timestamp?: string }): string {
  return JSON.stringify({
    isSidechain: opts.isSidechain ?? false,
    timestamp: opts.timestamp ?? "2026-09-15T00:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: opts.toolUseId, content: opts.text }],
    },
  });
}

test("parseNewContent 一次讀多行，回傳每個 assistant 訊息的 usage 事件", () => {
  const state = createTailState();
  const chunk = assistantLine({ id: "m1", cacheCreation: 100 }) + "\n" + assistantLine({ id: "m2", cacheCreation: 200 }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events.length, 2);
  assert.equal(events[0].messageId, "m1");
  assert.equal(events[0].usage?.cacheCreation, 100);
  assert.equal(events[1].messageId, "m2");
});

test("parseNewContent 對跨 chunk 斷行的最後一行，先暫存到下一次呼叫再解析", () => {
  const state = createTailState();
  const fullLine = assistantLine({ id: "m1", cacheCreation: 100 });
  const first = parseNewContent(fullLine.slice(0, 10), state);
  assert.equal(first.events.length, 0);
  const second = parseNewContent(fullLine.slice(10) + "\n", first.state);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].messageId, "m1");
});

test("parseNewContent 跳過壞掉的 JSON 行，不影響其他行", () => {
  const state = createTailState();
  const chunk = "not json\n" + assistantLine({ id: "m1", cacheCreation: 100 }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events.length, 1);
  assert.equal(events[0].messageId, "m1");
});

test("parseNewContent 保留 isSidechain 標記，不在這一層過濾", () => {
  const state = createTailState();
  const chunk = assistantLine({ id: "m1", cacheCreation: 100, isSidechain: true }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events[0].isSidechain, true);
});

test("parseNewContent 用稍早看到的 tool_use id 換回工具名稱（tool_use 與 tool_result 在不同行）", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }],
    }) +
    "\n" +
    toolResultLine({ toolUseId: "toolu_1", text: "x".repeat(50) }) +
    "\n";
  const { events } = parseNewContent(chunk, state);
  const toolResultEvent = events.find((e) => e.toolResultChars);
  assert.equal(toolResultEvent?.toolResultChars?.toolName, "Bash");
  assert.equal(toolResultEvent?.toolResultChars?.chars, 50);
});

test("parseNewContent 對不到 tool_use id 時，toolName 是 undefined", () => {
  const state = createTailState();
  const chunk = toolResultLine({ toolUseId: "toolu_missing", text: "x".repeat(10) }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events[0].toolResultChars?.toolName, undefined);
  assert.equal(events[0].toolResultChars?.chars, 10);
});

test("parseNewContent 對缺少 usage 的 assistant 行不產生事件，也不會拋錯", () => {
  const state = createTailState();
  const chunk = JSON.stringify({ isSidechain: false, message: { role: "assistant", id: "m1", content: [] } }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events.length, 0);
});
