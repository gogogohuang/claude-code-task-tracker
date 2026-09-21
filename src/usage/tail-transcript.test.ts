import assert from "node:assert/strict";
import test from "node:test";
import { createTailState, parseNewContent } from "./tail-transcript.js";

function assistantLine(opts: {
  id: string;
  cacheCreation: number;
  cacheRead?: number;
  output?: number;
  input?: number;
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
        input_tokens: opts.input ?? 0,
      },
      content: opts.content ?? [{ type: "text", text: "hi" }],
    },
  });
}

function aiTitleLine(aiTitle: string): string {
  return JSON.stringify({ type: "ai-title", aiTitle, timestamp: "2026-09-15T00:00:00.000Z" });
}

function userTextLine(content: unknown, opts?: { isSidechain?: boolean }): string {
  return JSON.stringify({
    isSidechain: opts?.isSidechain ?? false,
    timestamp: "2026-09-15T00:00:00.000Z",
    message: { role: "user", content },
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
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 2);
  assert.equal(events[0].messageId, "m1");
  assert.equal(events[0].usage?.cacheCreation, 100);
  assert.equal(events[1].messageId, "m2");
});

test("parseNewContent 對跨 chunk 斷行的最後一行，先暫存到下一次呼叫再解析", () => {
  const state = createTailState();
  const fullLine = assistantLine({ id: "m1", cacheCreation: 100 });
  const firstChunk = fullLine.slice(0, 10);
  const first = parseNewContent(firstChunk, state, Buffer.byteLength(firstChunk, "utf-8"));
  assert.equal(first.events.length, 0);
  const secondChunk = fullLine.slice(10) + "\n";
  const second = parseNewContent(secondChunk, first.state, Buffer.byteLength(secondChunk, "utf-8"));
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].messageId, "m1");
});

test("parseNewContent 跳過壞掉的 JSON 行，不影響其他行", () => {
  const state = createTailState();
  const chunk = "not json\n" + assistantLine({ id: "m1", cacheCreation: 100 }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 1);
  assert.equal(events[0].messageId, "m1");
});

test("parseNewContent 保留 isSidechain 標記，不在這一層過濾", () => {
  const state = createTailState();
  const chunk = assistantLine({ id: "m1", cacheCreation: 100, isSidechain: true }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
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
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  const toolResultEvent = events.find((e) => e.toolResultChars);
  assert.equal(toolResultEvent?.toolResultChars?.toolName, "Bash");
  assert.equal(toolResultEvent?.toolResultChars?.chars, 50);
});

test("parseNewContent 把 Read 的 file_path 帶到 toolResultChars.path 與 toolUsePath", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Read",
          input: { file_path: "/proj/src/schema.ts" },
        },
      ],
    }) +
    "\n" +
    toolResultLine({ toolUseId: "toolu_1", text: "x".repeat(20) }) +
    "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  const use = events.find((e) => e.toolUseName === "Read");
  assert.equal(use?.toolUsePath, "/proj/src/schema.ts");
  const result = events.find((e) => e.toolResultChars);
  assert.equal(result?.toolResultChars?.path, "/proj/src/schema.ts");
  assert.equal(result?.toolResultChars?.toolName, "Read");
});

test("parseNewContent 的 tool_use 事件帶上這次呼叫做了什麼的一句話", () => {
  const prev = process.env.TASK_TRACKER_LOCALE;
  process.env.TASK_TRACKER_LOCALE = "zh";
  try {
    const chunk =
      assistantLine({
        id: "m1",
        cacheCreation: 100,
        content: [
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/proj/src/a.ts" } },
          { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "npm test", description: "跑測試" } },
        ],
      }) + "\n";
    const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
    const summaries = events.filter((e) => e.toolUseName).map((e) => e.toolUseSummary);
    assert.match(summaries[0] ?? "", /^已讀取 .*a\.ts$/);
    assert.match(summaries[1] ?? "", /^已執行 /);
  } finally {
    if (prev === undefined) delete process.env.TASK_TRACKER_LOCALE;
    else process.env.TASK_TRACKER_LOCALE = prev;
  }
});

test("parseNewContent 對 tool_use block 另外發出 toolUseName 事件", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [
        { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
        { type: "tool_use", id: "toolu_2", name: "mcp__playwright__browser_click", input: {} },
      ],
    }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  const names = events.filter((e) => e.toolUseName).map((e) => e.toolUseName);
  assert.deepEqual(names, ["Read", "mcp__playwright__browser_click"]);
});

test("parseNewContent Skill／Agent 的 toolUseName 帶上 input 細節", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Skill",
          input: { skill: "superpowers:writing-plans" },
        },
        {
          type: "tool_use",
          id: "toolu_2",
          name: "Agent",
          input: { subagent_type: "Explore" },
        },
      ],
    }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  const names = events.filter((e) => e.toolUseName).map((e) => e.toolUseName);
  assert.deepEqual(names, ["Skill · superpowers:writing-plans", "Agent · Explore"]);
});

test("parseNewContent 對 Agent tool_use 事件帶出 agentDispatch（toolUseId/subagentType/description）", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Agent",
          input: { subagent_type: "Explore", description: "找 schema 定義" },
        },
      ],
    }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  const dispatch = events.find((e) => e.agentDispatch)?.agentDispatch;
  assert.deepEqual(dispatch, { toolUseId: "toolu_1", subagentType: "Explore", description: "找 schema 定義" });
});

test("parseNewContent 對非 Agent 的 tool_use 不帶 agentDispatch", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
    }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.some((e) => e.agentDispatch), false);
});

test("parseNewContent 把 tool_result 對應的 toolUseId 帶到 toolResultChars", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [{ type: "tool_use", id: "toolu_1", name: "Agent", input: { subagent_type: "Explore" } }],
    }) +
    "\n" +
    toolResultLine({ toolUseId: "toolu_1", text: "done" }) +
    "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  const result = events.find((e) => e.toolResultChars);
  assert.equal(result?.toolResultChars?.toolUseId, "toolu_1");
  assert.equal(result?.toolResultChars?.toolName, "Agent");
});

test("parseNewContent 對不到 tool_use id 時，toolName 是 undefined", () => {
  const state = createTailState();
  const chunk = toolResultLine({ toolUseId: "toolu_missing", text: "x".repeat(10) }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events[0].toolResultChars?.toolName, undefined);
  assert.equal(events[0].toolResultChars?.chars, 10);
});

test("parseNewContent 對缺少 usage 的 assistant 行不產生事件，也不會拋錯", () => {
  const state = createTailState();
  const chunk = JSON.stringify({ isSidechain: false, message: { role: "assistant", id: "m1", content: [] } }) + "\n";
  const { events } = parseNewContent(chunk, state, Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 0);
});

test("parseNewContent 的下一個 offset 用呼叫端傳入的真實 bytesRead，不會因為多位元組字元被讀取邊界切斷而跟磁碟位置脫節", () => {
  const state = createTailState();
  // 模擬磁碟上「中」這個多位元組字元（UTF-8 為 E4 B8 AD，3 bytes）剛好只讀到前 2 bytes；
  // decode 成字串會變成替代字元 U+FFFD，重新編碼卻是 3 bytes —— 如果 offset 用重新編碼後的
  // 長度去推算（舊寫法），就會跟磁碟上實際讀到的 2 bytes 對不上，下一次讀取位置錯位、掉行。
  const truncated = Buffer.from([0xe4, 0xb8]);
  const chunk = truncated.toString("utf-8");
  const actualBytesRead = truncated.byteLength;
  assert.notEqual(Buffer.byteLength(chunk, "utf-8"), actualBytesRead);

  const { state: nextState } = parseNewContent(chunk, state, actualBytesRead);
  assert.equal(nextState.offset, actualBytesRead);
});

test("parseNewContent 讀 type=ai-title 的 aiTitle，即使沒有 message 也不丟", () => {
  const chunk = aiTitleLine("修用量面板") + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "修用量面板");
  assert.equal(events[0].usage, undefined);
});

test("parseNewContent 空的 aiTitle 不產生事件", () => {
  const chunk = aiTitleLine("   ") + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 0);
});

test("parseNewContent 主線 user 字串當成 firstPrompt 候選", () => {
  const chunk = userTextLine("幫我修用量面板") + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events[0].userText, "幫我修用量面板");
});

test("parseNewContent 串起 array 裡 type=text 的文字", () => {
  const chunk = userTextLine([
    { type: "text", text: "第一段" },
    { type: "text", text: "第二段" },
  ]) + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events[0].userText, "第一段第二段");
});

test("parseNewContent 略過只有 tool_result、沒有 text 的 user 行（不當 userText）", () => {
  const chunk = userTextLine([{ type: "tool_result", tool_use_id: "t1", content: "x" }]) + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.every((event) => event.userText === undefined), true);
  assert.equal(events.some((event) => event.toolResultChars), true);
});

test("parseNewContent 略過 <local-command-caveat> 開頭的 user 文字", () => {
  const chunk = userTextLine("<local-command-caveat>\n/compact") + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 0);
});

test("parseNewContent 略過 trim 後空的 user 文字", () => {
  const chunk = userTextLine("   ") + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events.length, 0);
});

test("parseNewContent 把 input_tokens 寫進 usage.input", () => {
  const chunk = assistantLine({ id: "m1", cacheCreation: 100, input: 500 }) + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events[0].usage?.input, 500);
});

test("parseNewContent 缺少 input_tokens 時 usage.input 為 0", () => {
  const chunk = assistantLine({ id: "m1", cacheCreation: 100 }) + "\n";
  const { events } = parseNewContent(chunk, createTailState(), Buffer.byteLength(chunk, "utf-8"));
  assert.equal(events[0].usage?.input, 0);
});
