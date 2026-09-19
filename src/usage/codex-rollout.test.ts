import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { accumulate } from "./accumulate.js";
import { parseCodexRollout } from "./codex-rollout.js";
import { createTailState } from "./tail-transcript.js";

const SAMPLE = readFileSync(new URL("../fixtures/codex-0.155.1-rollout-sample.jsonl", import.meta.url), "utf-8");

test("parseCodexRollout：token_count 對應成 usage（cached / 重算 / 視窗），info 為 null 的略過", () => {
  const { events } = parseCodexRollout(SAMPLE, createTailState(), Buffer.byteLength(SAMPLE));
  const usageEvents = events.filter((e) => e.usage);
  assert.equal(usageEvents.length, 3); // 第 5、6 行重複各算一筆（去重在 accumulate），第 8 行 info=null 略過
  assert.deepEqual(usageEvents[0].usage, {
    input: 0,
    cacheRead: 15104,
    cacheCreation: 504,
    output: 157,
    contextWindow: 258400,
  });
  assert.equal(usageEvents[0].messageId, "total:15765");
  assert.equal(usageEvents[2].messageId, "total:32900");
  assert.deepEqual(usageEvents[2].usage, {
    input: 0,
    cacheRead: 16128,
    cacheCreation: 983,
    output: 24,
    contextWindow: 258400,
  });
  assert.equal(usageEvents[0].timestamp, "2026-09-19T13:13:02.000Z");
  assert.equal(usageEvents[0].isSidechain, false);
});

test("parseCodexRollout：custom_tool_call_output 的 text 長度，工具名由 call_id 對回", () => {
  const { events } = parseCodexRollout(SAMPLE, createTailState(), Buffer.byteLength(SAMPLE));
  const results = events.filter((e) => e.toolResultChars);
  assert.equal(results.length, 1);
  assert.equal(results[0].toolResultChars?.toolName, "exec");
  assert.equal(
    results[0].toolResultChars?.chars,
    "Script completed\nWall time 0.1 seconds\nOutput:\n".length + "hi\n".length,
  );
});

test("parseCodexRollout + accumulate：重複的 token_count 只算一次", () => {
  const { events } = parseCodexRollout(SAMPLE, createTailState(), Buffer.byteLength(SAMPLE));
  const { next } = accumulate({ ...emptyStats() }, events);
  assert.equal(next.mainThreadMsgCount, 2);
  assert.equal(next.lastOccupiedTokens, 17111);
  assert.equal(next.lastCacheRead, 16128);
  assert.equal(next.lastCacheCreation, 983);
});

test("parseCodexRollout：壞行、非物件、缺欄位都略過，不丟例外", () => {
  const chunk = [
    "not json",
    "123",
    JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } }),
    JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "x" } }),
    "",
  ].join("\n");
  const { events } = parseCodexRollout(chunk, createTailState(), Buffer.byteLength(chunk));
  assert.equal(events.filter((e) => e.usage).length, 0);
  // 沒有對應 call 的輸出仍會記一筆（長度 0、工具名未知），不影響後續
  assert.equal(events.filter((e) => e.toolResultChars).length, 1);
  assert.equal(events.find((e) => e.toolResultChars)?.toolResultChars?.chars, 0);
});

test("parseCodexRollout：跨 chunk 的半行接到下一次讀，offset 依 bytesRead 推進", () => {
  const lines = SAMPLE.trimEnd().split("\n");
  const cut = lines[4].length - 10;
  const first = lines.slice(0, 4).join("\n") + "\n" + lines[4].slice(0, cut);
  const second = lines[4].slice(cut) + "\n" + lines.slice(5).join("\n") + "\n";
  const r1 = parseCodexRollout(first, createTailState(), Buffer.byteLength(first));
  assert.equal(r1.events.filter((e) => e.usage).length, 0);
  assert.equal(r1.state.offset, Buffer.byteLength(first));
  const r2 = parseCodexRollout(second, r1.state, Buffer.byteLength(second));
  assert.equal(r2.events.filter((e) => e.usage).length, 3);
  assert.equal(r2.state.offset, Buffer.byteLength(first) + Buffer.byteLength(second));
});

test("parseCodexRollout：function_call / function_call_output（字串輸出）也算工具結果", () => {
  const chunk = [
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" } }),
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "abcde" } }),
    "",
  ].join("\n");
  const { events } = parseCodexRollout(chunk, createTailState(), Buffer.byteLength(chunk));
  assert.equal(events[0].toolResultChars?.toolName, "shell");
  assert.equal(events[0].toolResultChars?.chars, 5);
});

function emptyStats() {
  return {
    sessionId: "cx",
    mainThreadMsgCount: 0,
    sessionStartedAt: undefined,
    lastMsgAt: undefined,
    cacheCreationTotal: 0,
    cacheCreationRollingAvg: 0,
    recentMessageIds: [],
  };
}
