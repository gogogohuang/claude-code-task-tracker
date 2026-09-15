import assert from "node:assert/strict";
import test from "node:test";
import { accumulate } from "./accumulate.js";
import { detect } from "./detect.js";
import { createSessionUsageStats, ParsedEvent } from "./types.js";

function usageEvent(messageId: string, cacheCreation: number, timestamp: string): ParsedEvent {
  return { messageId, isSidechain: false, timestamp, usage: { cacheCreation, cacheRead: 0, output: 0 }, toolResultChars: undefined };
}

function toolResultEvent(toolName: string | undefined, chars: number, timestamp: string): ParsedEvent {
  return { messageId: undefined, isSidechain: false, timestamp, usage: undefined, toolResultChars: { toolName, chars } };
}

test("detect：long-session 訊息數剛好跨過 200 才觸發一次", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = Array.from({ length: 201 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  const advice = detect(stats0, next, steps);
  const longSession = advice.filter((a) => a.kind === "long-session");
  assert.equal(longSession.length, 1);
  assert.match(longSession[0].message, /\/clear/);
});

test("detect：long-session 剛好等於 200 則不觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = Array.from({ length: 200 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "long-session").length, 0);
});

test("detect：long-session 時間跨過 90 分鐘也會觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 10, "2026-09-15T00:00:00.000Z"), usageEvent("m1", 10, "2026-09-15T01:31:00.000Z")];
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "long-session").length, 1);
});

test("detect：cache-spike 在 mainThreadMsgCount < 5 時不觸發，即使數字很大", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 100, "t0"), usageEvent("m1", 999999, "t1")];
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "cache-spike").length, 0);
});

test("detect：cache-spike 在累積 5 則後，單輪超過 max(20000, 5x平均) 時觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  // rolling avg 是 1000，5x=5000，門檻取 max(20000,5000)=20000，30000 超過
  const { next, steps } = accumulate(warmup.next, [usageEvent("spike", 30000, "tspike")]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.equal(spikeAdvice.length, 1);
  assert.match(spikeAdvice[0].message, /30,000/);
  assert.match(spikeAdvice[0].message, /\/clear/);
});

test("detect：heavy-baseline 只在第一則訊息判斷，之後即使 cacheCreation 很大也不誤判", () => {
  const stats0 = createSessionUsageStats("s1");
  const first = accumulate(stats0, [usageEvent("m0", 60000, "t0")]);
  assert.equal(detect(stats0, first.next, first.steps).filter((a) => a.kind === "heavy-baseline").length, 1);

  const second = accumulate(first.next, [usageEvent("m1", 60000, "t1")]);
  assert.equal(detect(first.next, second.next, second.steps).filter((a) => a.kind === "heavy-baseline").length, 0);
});

test("detect：heavy-baseline 剛好等於 50000 不觸發，超過才觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const exact = accumulate(stats0, [usageEvent("m0", 50000, "t0")]);
  assert.equal(detect(stats0, exact.next, exact.steps).filter((a) => a.kind === "heavy-baseline").length, 0);
});

test("detect：fat-tool-result 剛好等於 30000 字元不觸發，超過才觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const exact = accumulate(stats0, [toolResultEvent("Bash", 30000, "t0")]);
  assert.equal(detect(stats0, exact.next, exact.steps).length, 0);

  const over = accumulate(stats0, [toolResultEvent("Bash", 30001, "t0")]);
  const overAdvice = detect(stats0, over.next, over.steps);
  assert.equal(overAdvice.length, 1);
  assert.equal(overAdvice[0].kind, "fat-tool-result");
  assert.match(overAdvice[0].message, /Bash/);
});

test("detect：fat-tool-result 對不到工具名稱時顯示「工具」", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent(undefined, 40000, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.match(advice[0].message, /^重跑剛剛那個 工具 呼叫/);
});
