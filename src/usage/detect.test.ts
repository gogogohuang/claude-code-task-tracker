import assert from "node:assert/strict";
import test from "node:test";
import { accumulate } from "./accumulate.js";
import { detect } from "./detect.js";
import { createSessionUsageStats, ParsedEvent } from "./types.js";

function usageEvent(messageId: string, cacheCreation: number, timestamp: string): ParsedEvent {
  return { messageId, isSidechain: false, timestamp, usage: { cacheCreation, cacheRead: 0, output: 0, input: 0 }, toolResultChars: undefined };
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
  assert.match(longSession[0].message, /docs\/superpowers\/plans\//);
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

test("detect：long-session 超過 60 分鐘顯示「X 小時 Y 分鐘」", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 10, "2026-09-15T00:00:00.000Z"), usageEvent("m1", 10, "2026-09-15T03:07:00.000Z")];
  const { next, steps } = accumulate(stats0, events);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "long-session")[0].message;
  assert.match(msg, /3 小時 7 分鐘/);
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
  assert.match(spikeAdvice[0].message, /30K/);
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

test("detect：fat-tool-result 估算 token 剛好等於門檻（8000）不觸發，超過才觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  // 32000 字元 / 4 = 8000 token，剛好等於門檻
  const exact = accumulate(stats0, [toolResultEvent("Bash", 32000, "t0")]);
  assert.equal(detect(stats0, exact.next, exact.steps).length, 0);

  // 32004 字元 / 4 = 8001 token，超過門檻
  const over = accumulate(stats0, [toolResultEvent("Bash", 32004, "t0")]);
  const overAdvice = detect(stats0, over.next, over.steps);
  assert.equal(overAdvice.length, 1);
  assert.equal(overAdvice[0].kind, "fat-tool-result");
  assert.match(overAdvice[0].message, /Bash/);
  assert.match(overAdvice[0].message, /8K token/);
  assert.match(overAdvice[0].message, /context window/);
});

test("detect：fat-tool-result 對不到工具名稱時顯示「工具」", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent(undefined, 40000, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.match(advice[0].message, /^重跑剛剛那個 工具 呼叫/);
});

test("detect：fat-tool-result 對 Agent 改叫只交結論與檔案路徑", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent("Agent", 40000, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.equal(advice.length, 1);
  assert.equal(advice[0].kind, "fat-tool-result");
  assert.match(advice[0].message, /結論與檔案路徑/);
  assert.equal(/head\/grep\/limit/.test(advice[0].message), false);
  assert.match(advice[0].message, /10K token/);
});

test("detect：fat-tool-result 有 path 時文案帶路徑", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [
    {
      messageId: undefined,
      isSidechain: false,
      timestamp: "t0",
      usage: undefined,
      toolResultChars: { toolName: "Read", chars: 40000, path: "/proj/big.ts" },
    },
  ]);
  const advice = detect(stats0, next, steps);
  assert.equal(advice[0].kind, "fat-tool-result");
  assert.match(advice[0].message, /\/proj\/big\.ts/);
  assert.match(advice[0].message, /offset|limit|head/);
});

test("detect：repeated-read 同 path 第 3 次才觸發一次", () => {
  const stats0 = createSessionUsageStats("s1");
  const reads = (n: number): ParsedEvent[] =>
    Array.from({ length: n }, () => ({
      messageId: undefined,
      isSidechain: false,
      timestamp: "t",
      usage: undefined,
      toolResultChars: undefined,
      toolUseName: "Read",
      toolUsePath: "/proj/a.ts",
    }));
  const two = accumulate(stats0, reads(2));
  assert.equal(detect(stats0, two.next, two.steps).filter((a) => a.kind === "repeated-read").length, 0);
  const three = accumulate(two.next, reads(1));
  const advice = detect(two.next, three.next, three.steps).filter((a) => a.kind === "repeated-read");
  assert.equal(advice.length, 1);
  assert.match(advice[0].message, /\/proj\/a\.ts/);
  assert.match(advice[0].message, /offset\/limit/);
  const four = accumulate(three.next, reads(1));
  assert.equal(detect(three.next, four.next, four.steps).filter((a) => a.kind === "repeated-read").length, 0);
});

test("detect：Codex 的 long-session 不提 /clear，改說另開新 session", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const events = Array.from({ length: 201 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "long-session")[0].message;
  assert.match(msg, /另開新 session/);
  assert.match(msg, /docs\/superpowers\/plans\//);
  assert.doesNotMatch(msg, /\/clear/);
});

test("detect：Codex 的 cache-spike 說可能是閒置過期，不怪 MCP 設定", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const events = [
    ...Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 100, "t")),
    usageEvent("spike", 50000, "t"),
  ];
  const { next, steps } = accumulate(stats0, events);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "cache-spike")[0].message;
  assert.match(msg, /閒置太久 cache 過期/);
  assert.match(msg, /50K/);
  assert.doesNotMatch(msg, /MCP 設定/);
});

test("detect：Codex 的 heavy-baseline 不提 inspect", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const { next, steps } = accumulate(stats0, [usageEvent("m0", 60001, "t")]);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "heavy-baseline")[0].message;
  assert.match(msg, /開場偏重/);
  assert.doesNotMatch(msg, /inspect/);
});

test("detect：Codex 的 fat-tool-result 用 Codex 文案，佔用率用該 session 的視窗", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const usage: ParsedEvent = {
    messageId: "u1",
    isSidechain: false,
    timestamp: "t",
    usage: { input: 0, cacheRead: 0, cacheCreation: 10, output: 0, contextWindow: 100_000 },
    toolResultChars: undefined,
  };
  // 40,000 字元 ≈ 10,000 token（>8000 門檻）；視窗 100,000 → 10%
  const { next, steps } = accumulate(stats0, [usage, toolResultEvent("exec", 40_000, "t")]);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "fat-tool-result")[0].message;
  assert.match(msg, /exec/);
  assert.match(msg, /head\/grep/);
  assert.match(msg, /約占 context window 10%/);
  assert.doesNotMatch(msg, /offset\/limit/);
});

test("detect：Codex 第一個事件就是肥 tool result（還沒有視窗資訊）時，以 258,400 當分母", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  // 40,000 字元 ≈ 10,000 token；258,400 視窗 → 4%
  const { next, steps } = accumulate(stats0, [toolResultEvent("exec", 40_000, "t")]);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "fat-tool-result")[0].message;
  assert.match(msg, /約占 context window 4%/);
});
