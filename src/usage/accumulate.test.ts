import assert from "node:assert/strict";
import test from "node:test";
import { accumulate } from "./accumulate.js";
import { createSessionUsageStats, ParsedEvent } from "./types.js";

function usageEvent(overrides: Partial<ParsedEvent> & { usage: NonNullable<ParsedEvent["usage"]> }): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp: "2026-09-15T00:00:00.000Z",
    toolResultChars: undefined,
    ...overrides,
  };
}

function toolResultEventFixture(toolName: string | undefined, chars: number): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp: "2026-09-15T00:00:00.000Z",
    usage: undefined,
    toolResultChars: { toolName, chars },
  };
}

test("accumulate 疊加多個事件的 cache_creation 與 rolling average", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [
    usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 0, output: 10, input: 0 } }),
    usageEvent({ messageId: "m2", usage: { cacheCreation: 300, cacheRead: 0, output: 10, input: 0 } }),
  ]);
  assert.equal(next.mainThreadMsgCount, 2);
  assert.equal(next.cacheCreationTotal, 400);
  assert.equal(next.cacheCreationRollingAvg, 200);
});

test("accumulate 同一個 messageId 出現多次只採計一次（模擬 thinking + tool_use 共用一輪 usage）", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [
    usageEvent({ messageId: "m1", usage: { cacheCreation: 132914, cacheRead: 0, output: 10, input: 0 } }),
    usageEvent({ messageId: "m1", usage: { cacheCreation: 132914, cacheRead: 0, output: 10, input: 0 } }),
  ]);
  assert.equal(next.mainThreadMsgCount, 1);
  assert.equal(next.cacheCreationTotal, 132914);
  assert.equal(steps.filter((s) => s.event.usage).length, 1);
});

test("accumulate 去重跨越兩次呼叫（同一輪的兩行分別在不同 chunk）", () => {
  const stats0 = createSessionUsageStats("s1");
  const first = accumulate(stats0, [usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 0, output: 0, input: 0 } })]);
  const second = accumulate(first.next, [usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 0, output: 0, input: 0 } })]);
  assert.equal(second.next.mainThreadMsgCount, 1);
  assert.equal(second.next.cacheCreationTotal, 100);
});

test("accumulate 忽略 isSidechain 的事件", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [
    usageEvent({ messageId: "m1", isSidechain: true, usage: { cacheCreation: 999999, cacheRead: 0, output: 0, input: 0 } }),
  ]);
  assert.equal(next.mainThreadMsgCount, 0);
  assert.equal(next.cacheCreationTotal, 0);
});

test("accumulate 把 tool_result 事件原封不動放進 steps，不影響 usage 統計或去重", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEventFixture("Bash", 500)]);
  assert.equal(next.mainThreadMsgCount, 0);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].event.toolResultChars?.chars, 500);
  assert.equal(steps[0].statsBefore, steps[0].statsAfter);
});

test("accumulate recentMessageIds 超過上限（30）時丟掉最舊的，較新的 id 仍會被去重", () => {
  let stats = createSessionUsageStats("s1");
  for (let i = 0; i < 35; i++) {
    stats = accumulate(stats, [usageEvent({ messageId: `m${i}`, usage: { cacheCreation: 10, cacheRead: 0, output: 0, input: 0 } })]).next;
  }
  assert.equal(stats.mainThreadMsgCount, 35);

  // m0 已經被擠出緩衝，重放會被誤判成新事件（緩衝有界是刻意的取捨，見 spec）
  const replayOld = accumulate(stats, [usageEvent({ messageId: "m0", usage: { cacheCreation: 10, cacheRead: 0, output: 0, input: 0 } })]);
  assert.equal(replayOld.next.mainThreadMsgCount, 36);

  // m34 還在緩衝內，重放會被正確去重
  const replayRecent = accumulate(stats, [usageEvent({ messageId: "m34", usage: { cacheCreation: 10, cacheRead: 0, output: 0, input: 0 } })]);
  assert.equal(replayRecent.next.mainThreadMsgCount, 35);
});

function titleEvent(title: string, isSidechain = false): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain,
    timestamp: "2026-09-15T00:00:00.000Z",
    usage: undefined,
    toolResultChars: undefined,
    title,
  };
}

function userTextEvent(userText: string, isSidechain = false): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain,
    timestamp: "2026-09-15T00:00:00.000Z",
    usage: undefined,
    toolResultChars: undefined,
    userText,
  };
}

test("accumulate 只記第一次 title 與 firstPrompt", () => {
  const stats0 = createSessionUsageStats("s1");
  const first = accumulate(stats0, [titleEvent("修用量面板"), userTextEvent("幫我修")]);
  assert.equal(first.next.title, "修用量面板");
  assert.equal(first.next.firstPrompt, "幫我修");
  const second = accumulate(first.next, [titleEvent("另一個標題"), userTextEvent("另一句")]);
  assert.equal(second.next.title, "修用量面板");
  assert.equal(second.next.firstPrompt, "幫我修");
});

test("accumulate 忽略 sidechain 的 userText，但 sidechain 的 title 仍取第一次", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [
    titleEvent("子代理標題", true),
    userTextEvent("子代理 prompt", true),
    userTextEvent("主線 prompt"),
  ]);
  assert.equal(next.title, "子代理標題");
  assert.equal(next.firstPrompt, "主線 prompt");
});

test("accumulate lastOccupiedTokens 是 input + cacheRead + cacheCreation，隨最新一則去重後主線 usage 覆寫", () => {
  const stats0 = createSessionUsageStats("s1");
  const first = accumulate(stats0, [
    usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 20, output: 9, input: 5 } }),
  ]);
  assert.equal(first.next.lastOccupiedTokens, 125);
  assert.equal(first.next.lastInput, 5);
  assert.equal(first.next.lastCacheRead, 20);
  assert.equal(first.next.lastCacheCreation, 100);
  const second = accumulate(first.next, [
    usageEvent({ messageId: "m1", usage: { cacheCreation: 999, cacheRead: 999, output: 9, input: 999 } }),
    usageEvent({ messageId: "m2", usage: { cacheCreation: 10, cacheRead: 200, output: 1, input: 50 } }),
  ]);
  assert.equal(second.next.lastOccupiedTokens, 260);
  assert.equal(second.next.lastInput, 50);
  assert.equal(second.next.lastCacheRead, 200);
  assert.equal(second.next.lastCacheCreation, 10);
});

test("accumulate 沒有主線 usage 時 lastOccupiedTokens 仍是 undefined", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [userTextEvent("只有 prompt")]);
  assert.equal(next.lastOccupiedTokens, undefined);
  assert.equal(next.lastInput, undefined);
  assert.equal(next.lastCacheRead, undefined);
  assert.equal(next.lastCacheCreation, undefined);
});

function toolUseEvent(toolUseName: string, isSidechain = false): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain,
    timestamp: "2026-09-15T00:00:00.000Z",
    usage: undefined,
    toolResultChars: undefined,
    toolUseName,
  };
}

test("accumulate 主線 toolUseName 寫入 toolInventory", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [
    toolUseEvent("Read"),
    toolUseEvent("Read"),
    toolUseEvent("mcp__playwright__browser_click"),
  ]);
  assert.deepEqual(next.toolInventory?.tools, { Read: 2 });
  assert.deepEqual(next.toolInventory?.mcpTools, { "playwright/browser_click": 1 });
});

test("accumulate 忽略 sidechain 的 toolUseName", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [toolUseEvent("Bash", true), toolUseEvent("Read")]);
  assert.deepEqual(next.toolInventory?.tools, { Read: 1 });
});

test("accumulate：usage 帶 contextWindow 時記成 lastContextWindow；沒帶就不出現這個鍵", () => {
  const stats0 = createSessionUsageStats("s1");
  const withWindow = accumulate(stats0, [
    { messageId: "a", isSidechain: false, timestamp: "t", usage: { input: 0, cacheRead: 1, cacheCreation: 2, output: 3, contextWindow: 258400 }, toolResultChars: undefined },
  ]);
  assert.equal(withWindow.next.lastContextWindow, 258400);

  const without = accumulate(stats0, [
    { messageId: "b", isSidechain: false, timestamp: "t", usage: { input: 0, cacheRead: 1, cacheCreation: 2, output: 3 }, toolResultChars: undefined },
  ]);
  assert.equal("lastContextWindow" in without.next, false);
});

test("createSessionUsageStats：只有 codex 才帶 agent 鍵", () => {
  assert.equal("agent" in createSessionUsageStats("s1"), false);
  assert.equal(createSessionUsageStats("s1", "codex").agent, "codex");
});

function workEvent(
  messageId: string | undefined,
  usage: { input: number; cacheCreation: number; cacheRead: number; output: number },
  isSidechain = false,
): ParsedEvent {
  return { messageId, isSidechain, timestamp: "t", usage, toolResultChars: undefined };
}

test("accumulate：workTokensTotal 逐事件累加 input + cacheCreation + output，不含 cacheRead", () => {
  const { next } = accumulate(createSessionUsageStats("s1"), [
    workEvent("a", { input: 10, cacheCreation: 200, cacheRead: 5000, output: 30 }),
    workEvent("b", { input: 1, cacheCreation: 2, cacheRead: 9000, output: 3 }),
  ]);
  assert.equal(next.workTokensTotal, 246); // (10 + 200 + 30) + (1 + 2 + 3)
});

test("accumulate：重複 messageId 不重複累加 workTokensTotal", () => {
  const usage = { input: 0, cacheCreation: 200, cacheRead: 0, output: 40 };
  const { next } = accumulate(createSessionUsageStats("s1"), [workEvent("a", usage), workEvent("a", usage)]);
  assert.equal(next.workTokensTotal, 240);
});

test("accumulate：sidechain（子 agent）事件不計入 workTokensTotal", () => {
  const { next } = accumulate(createSessionUsageStats("s1"), [
    workEvent("a", { input: 0, cacheCreation: 100, cacheRead: 0, output: 0 }),
    workEvent("b", { input: 0, cacheCreation: 9999, cacheRead: 0, output: 9999 }, true),
  ]);
  assert.equal(next.workTokensTotal, 100);
});

test("accumulate：沒有 usage 的事件不產生 workTokensTotal 這個鍵", () => {
  const { next } = accumulate(createSessionUsageStats("s1"), [
    { messageId: undefined, isSidechain: false, timestamp: "t", usage: undefined, toolResultChars: { toolName: "Bash", chars: 10 } },
  ]);
  assert.equal("workTokensTotal" in next, false);
});

test("accumulate：Codex 對應（input 0、cacheCreation = 沒命中 cache 的部分）也用同一條公式", () => {
  const { next } = accumulate(createSessionUsageStats("cx", "codex"), [
    workEvent("total:32900", { input: 0, cacheCreation: 983, cacheRead: 16128, output: 24 }),
  ]);
  assert.equal(next.workTokensTotal, 1007);
});
