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
