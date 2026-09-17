import assert from "node:assert/strict";
import test from "node:test";
import { ParsedEvent } from "./types.js";
import { applySubagentEvents, createSubagentsState, dispatchLabel } from "./subagents.js";

function dispatchEvent(opts: { toolUseId: string; subagentType?: string; description?: string; timestamp?: string }): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp: opts.timestamp,
    usage: undefined,
    toolResultChars: undefined,
    toolUseName: opts.subagentType ? `Agent · ${opts.subagentType}` : "Agent",
    agentDispatch: { toolUseId: opts.toolUseId, subagentType: opts.subagentType, description: opts.description },
  };
}

function dispatchDoneEvent(opts: { toolUseId: string; timestamp?: string }): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp: opts.timestamp,
    usage: undefined,
    toolResultChars: { toolName: "Agent", chars: 10, toolUseId: opts.toolUseId },
  };
}

function sidechainToolUseEvent(opts: { toolUseName: string; toolUsePath?: string; timestamp?: string }): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: true,
    timestamp: opts.timestamp,
    usage: undefined,
    toolResultChars: undefined,
    toolUseName: opts.toolUseName,
    toolUsePath: opts.toolUsePath,
  };
}

test("createSubagentsState 一開始沒有派發、沒有 sidechain 活動", () => {
  const state = createSubagentsState();
  assert.deepEqual(state.dispatches, []);
  assert.equal(state.latestSidechainActivity, undefined);
});

test("applySubagentEvents 把 Agent tool_use 事件登記成 running 的派發", () => {
  const state = applySubagentEvents(createSubagentsState(), [
    dispatchEvent({ toolUseId: "toolu_1", subagentType: "Explore", description: "找 schema 定義", timestamp: "t0" }),
  ]);
  assert.equal(state.dispatches.length, 1);
  assert.deepEqual(state.dispatches[0], {
    toolUseId: "toolu_1",
    subagentType: "Explore",
    description: "找 schema 定義",
    status: "running",
    startedAt: "t0",
    endedAt: undefined,
  });
});

test("applySubagentEvents 用 toolResultChars 的 toolUseId 把對應派發標成 done", () => {
  const state = applySubagentEvents(createSubagentsState(), [
    dispatchEvent({ toolUseId: "toolu_1", subagentType: "Explore" }),
    dispatchDoneEvent({ toolUseId: "toolu_1", timestamp: "t1" }),
  ]);
  assert.equal(state.dispatches[0].status, "done");
  assert.equal(state.dispatches[0].endedAt, "t1");
});

test("applySubagentEvents 累積多筆派發，保持派發順序", () => {
  const state = applySubagentEvents(createSubagentsState(), [
    dispatchEvent({ toolUseId: "toolu_1", subagentType: "Explore" }),
    dispatchEvent({ toolUseId: "toolu_2", subagentType: "general-purpose" }),
  ]);
  assert.deepEqual(
    state.dispatches.map((d) => d.toolUseId),
    ["toolu_1", "toolu_2"],
  );
});

test("applySubagentEvents 非 Agent 的 tool_result 不影響既有派發狀態", () => {
  const state = applySubagentEvents(createSubagentsState(), [
    dispatchEvent({ toolUseId: "toolu_1", subagentType: "Explore" }),
    {
      messageId: undefined,
      isSidechain: false,
      timestamp: "t1",
      usage: undefined,
      toolResultChars: { toolName: "Read", chars: 5 },
    },
  ]);
  assert.equal(state.dispatches[0].status, "running");
});

test("applySubagentEvents 記錄最新一筆 sidechain 活動句", () => {
  const state = applySubagentEvents(createSubagentsState(), [
    sidechainToolUseEvent({ toolUseName: "Read", toolUsePath: "/proj/a.ts", timestamp: "t0" }),
    sidechainToolUseEvent({ toolUseName: "Bash", timestamp: "t1" }),
  ]);
  assert.deepEqual(state.latestSidechainActivity, { text: "Bash", at: "t1" });
});

test("applySubagentEvents 忽略非 sidechain 的 tool_use，不更新 latestSidechainActivity", () => {
  const state = applySubagentEvents(createSubagentsState(), [
    { messageId: undefined, isSidechain: false, timestamp: "t0", usage: undefined, toolResultChars: undefined, toolUseName: "Read" },
  ]);
  assert.equal(state.latestSidechainActivity, undefined);
});

test("dispatchLabel 有 description 時用 subagentType · description", () => {
  const label = dispatchLabel({
    toolUseId: "toolu_1",
    subagentType: "Explore",
    description: "找 schema 定義",
    status: "running",
  });
  assert.equal(label, "Explore · 找 schema 定義");
});

test("dispatchLabel 沒有 subagentType／description 時退回 toolUseId", () => {
  const label = dispatchLabel({ toolUseId: "toolu_1", status: "running" });
  assert.equal(label, "agent · toolu_1");
});
