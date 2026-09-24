import assert from "node:assert/strict";
import test from "node:test";
import { accumulate } from "./accumulate.js";
import { detect, FAT_TOOL_RESULT_TOKENS, fatToolResultSeverity } from "./detect.js";
import { createSessionUsageStats, ParsedEvent } from "./types.js";

function usageEvent(messageId: string, cacheCreation: number, timestamp: string): ParsedEvent {
  return { messageId, isSidechain: false, timestamp, usage: { cacheCreation, cacheRead: 0, output: 0, input: 0 }, toolResultChars: undefined };
}

function usageEventWithReason(
  messageId: string,
  cacheCreation: number,
  timestamp: string,
  cacheMissReason: { type: string; cacheMissedInputTokens?: number },
): ParsedEvent {
  return { ...usageEvent(messageId, cacheCreation, timestamp), cacheMissReason };
}

function toolResultEvent(toolName: string | undefined, chars: number, timestamp: string): ParsedEvent {
  return { messageId: undefined, isSidechain: false, timestamp, usage: undefined, toolResultChars: { toolName, chars } };
}

function toolUseEvent(toolName: string, timestamp: string, opts?: { path?: string; summary?: string }): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp,
    usage: undefined,
    toolResultChars: undefined,
    toolUseName: toolName,
    toolUsePath: opts?.path,
    toolUseSummary: opts?.summary,
  };
}

test("detect：long-session 訊息數剛好跨過 200 才觸發一次", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = Array.from({ length: 201 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  const advice = detect(stats0, next, steps);
  const longSession = advice.filter((a) => a.kind === "long-session");
  assert.equal(longSession.length, 1);
  assert.match(longSession[0].action, /\/clear/);
  assert.match(longSession[0].action, /docs\/superpowers\/plans\//);
  assert.equal(longSession[0].severity, "warn");
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

test("detect：long-session 超過 60 分鐘顯示「X 小時 Y 分鐘」，門檻寫在 summary 裡", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 10, "2026-09-15T00:00:00.000Z"), usageEvent("m1", 10, "2026-09-15T03:07:00.000Z")];
  const { next, steps } = accumulate(stats0, events);
  const summary = detect(stats0, next, steps).filter((a) => a.kind === "long-session")[0].summary;
  assert.match(summary, /3 小時 7 分鐘/);
  assert.match(summary, /門檻 200 則／90 分鐘/);
});

test("detect：long-session 一次跨過時長 1.5 倍門檻（135 分鐘）升級為 critical", () => {
  const stats0 = createSessionUsageStats("s1");
  // long-session 只在「未跨過 → 跨過」那一步觸發一次，訊息數本身無法在單步內跳到 1.5 倍（每步只 +1）；
  // 用時間一次跳過 135 分鐘（90 分鐘門檻的 1.5 倍）來測 critical 分支。
  const events = [usageEvent("m0", 10, "2026-09-15T00:00:00.000Z"), usageEvent("m1", 10, "2026-09-15T02:15:00.000Z")];
  const { next, steps } = accumulate(stats0, events);
  const advice = detect(stats0, next, steps).filter((a) => a.kind === "long-session");
  assert.equal(advice.length, 1);
  assert.equal(advice[0].severity, "critical");
});

test("detect：cache-spike 在 mainThreadMsgCount < 5 時不觸發，即使數字很大", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 100, "t0"), usageEvent("m1", 999999, "t1")];
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "cache-spike").length, 0);
});

test("detect：cache-spike 在累積 5 則後，單輪超過 max(20000, 5x平均) 時觸發，summary 顯示倍數", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  // rolling avg 是 1000，5x=5000，門檻取 max(20000,5000)=20000，30000 超過（未達 2 倍門檻 40000，屬 warn）
  const { next, steps } = accumulate(warmup.next, [usageEvent("spike", 30000, "tspike")]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.equal(spikeAdvice.length, 1);
  assert.match(spikeAdvice[0].summary, /30K/);
  assert.match(spikeAdvice[0].summary, /30 倍（門檻 5 倍）/);
  assert.match(spikeAdvice[0].action, /\/clear/);
  assert.equal(spikeAdvice[0].severity, "warn");
});

test("detect：cache-spike 達 2 倍門檻升級為 critical", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  // 門檻 20000，2 倍 = 40000；50000 超過
  const { next, steps } = accumulate(warmup.next, [usageEvent("spike", 50000, "tspike")]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.equal(spikeAdvice[0].severity, "critical");
});

test("detect：cache-spike 有 cacheMissReason=messages_changed 時，detailLines 附上人話原因", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "messages_changed", cacheMissedInputTokens: 30000 }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, ["原因（API 回報）：訊息內容跟快取版本不一致"]);
});

test("detect：cache-spike 有 cacheMissReason=previous_message_not_found 時，detailLines 附上人話原因", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "previous_message_not_found" }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, [
    "原因（API 回報）：找不到快取參照的上一則訊息（可能剛 /clear、開新 session、或快取已過期）",
  ]);
});

test("detect：cache-spike 是 messages_changed 且之前有工具呼叫時，detailLines 附上「最近一次工具呼叫」", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(
    stats0,
    Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)).concat([
      toolUseEvent("Bash", "t5", { summary: "已執行 npm test" }),
    ]),
  );
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "messages_changed" }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, [
    "原因（API 回報）：訊息內容跟快取版本不一致",
    "最近一次工具呼叫：Bash（已執行 npm test）",
  ]);
});

test("detect：cache-spike 是 messages_changed 但沒有 summary 時，退回顯示 path", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(
    stats0,
    Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)).concat([
      toolUseEvent("Read", "t5", { path: "src/foo.ts" }),
    ]),
  );
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "messages_changed" }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, [
    "原因（API 回報）：訊息內容跟快取版本不一致",
    "最近一次工具呼叫：Read（src/foo.ts）",
  ]);
});

test("detect：cache-spike 是 previous_message_not_found 時，即使之前有工具呼叫也不附「最近一次工具呼叫」", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(
    stats0,
    Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)).concat([toolUseEvent("Bash", "t5")]),
  );
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "previous_message_not_found" }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, [
    "原因（API 回報）：找不到快取參照的上一則訊息（可能剛 /clear、開新 session、或快取已過期）",
  ]);
});

test("detect：cache-spike 是 messages_changed 但之前沒有任何工具呼叫時，detailLines 只有原因那行", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "messages_changed" }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, ["原因（API 回報）：訊息內容跟快取版本不一致"]);
});

test("detect：cache-spike 遇到未知 cacheMissReason type 時，用原始字串當保底文案", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  const { next, steps } = accumulate(warmup.next, [
    usageEventWithReason("spike", 30000, "tspike", { type: "some_future_reason" }),
  ]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.deepEqual(spikeAdvice[0].detailLines, ["原因（API 回報）：some_future_reason"]);
});

test("detect：cache-spike 沒有 cacheMissReason 時，detailLines 維持 undefined（不強行湊字）", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  const { next, steps } = accumulate(warmup.next, [usageEvent("spike", 30000, "tspike")]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.equal(spikeAdvice[0].detailLines, undefined);
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

test("detect：heavy-baseline 達 2 倍門檻（100000）升級為 critical", () => {
  const stats0 = createSessionUsageStats("s1");
  const over = accumulate(stats0, [usageEvent("m0", 100001, "t0")]);
  const advice = detect(stats0, over.next, over.steps).filter((a) => a.kind === "heavy-baseline");
  assert.equal(advice[0].severity, "critical");
  assert.match(advice[0].summary, /門檻 50K/);
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
  assert.equal(overAdvice[0].severity, "warn");
  assert.match(overAdvice[0].summary, /Bash/);
  assert.match(overAdvice[0].summary, /8K token/);
  assert.match(overAdvice[0].summary, /context window/);
});

test("detect：fat-tool-result 達 2 倍門檻（16000）升級為 critical", () => {
  const stats0 = createSessionUsageStats("s1");
  const over = accumulate(stats0, [toolResultEvent("Bash", 64004, "t0")]);
  const advice = detect(stats0, over.next, over.steps);
  assert.equal(advice[0].severity, "critical");
});

test("detect：fat-tool-result 對不到工具名稱時顯示「工具」", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent(undefined, 40000, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.match(advice[0].summary, /^工具 /);
});

test("detect：fat-tool-result 對 Agent 改叫只交結論與檔案路徑", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent("Agent", 40000, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.equal(advice.length, 1);
  assert.equal(advice[0].kind, "fat-tool-result");
  assert.match(advice[0].action, /結論與檔案路徑/);
  assert.equal(/head\/grep\/limit/.test(advice[0].action), false);
  assert.match(advice[0].summary, /10K token/);
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
  assert.match(advice[0].summary, /\/proj\/big\.ts/);
  assert.match(advice[0].action, /offset|limit|head/);
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
  assert.match(advice[0].summary, /\/proj\/a\.ts/);
  assert.match(advice[0].action, /offset\/limit/);
  assert.equal(advice[0].severity, "warn");
  const four = accumulate(three.next, reads(1));
  assert.equal(detect(three.next, four.next, four.steps).filter((a) => a.kind === "repeated-read").length, 0);
});

test("detect：Codex 的 long-session 不提 /clear，改說另開新 session", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const events = Array.from({ length: 201 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  const action = detect(stats0, next, steps).filter((a) => a.kind === "long-session")[0].action;
  assert.match(action, /另開新 session/);
  assert.match(action, /docs\/superpowers\/plans\//);
  assert.doesNotMatch(action, /\/clear/);
});

test("detect：Codex 的 cache-spike 說可能是閒置過期，不怪 MCP 設定", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const events = [
    ...Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 100, "t")),
    usageEvent("spike", 50000, "t"),
  ];
  const { next, steps } = accumulate(stats0, events);
  const advice = detect(stats0, next, steps).filter((a) => a.kind === "cache-spike")[0];
  assert.match(advice.summary, /閒置太久 cache 過期/);
  assert.match(advice.summary, /50K/);
  assert.doesNotMatch(advice.action, /MCP 設定/);
});

test("detect：Codex 的 heavy-baseline 不提 inspect", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const { next, steps } = accumulate(stats0, [usageEvent("m0", 60001, "t")]);
  const advice = detect(stats0, next, steps).filter((a) => a.kind === "heavy-baseline")[0];
  assert.match(advice.summary, /開場偏重/);
  assert.doesNotMatch(advice.action, /inspect/);
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
  const advice = detect(stats0, next, steps).filter((a) => a.kind === "fat-tool-result")[0];
  assert.match(advice.summary, /exec/);
  assert.match(advice.action, /head\/grep/);
  assert.match(advice.summary, /約占 context window 10%/);
  assert.doesNotMatch(advice.action, /offset\/limit/);
});

test("detect：Codex 第一個事件就是肥 tool result（還沒有視窗資訊）時，以 258,400 當分母", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  // 40,000 字元 ≈ 10,000 token；258,400 視窗 → 4%
  const { next, steps } = accumulate(stats0, [toolResultEvent("exec", 40_000, "t")]);
  const advice = detect(stats0, next, steps).filter((a) => a.kind === "fat-tool-result")[0];
  assert.match(advice.summary, /約占 context window 4%/);
});

test("fatToolResultSeverity：未過門檻回 undefined，過門檻 warn，達 2 倍門檻 critical", () => {
  assert.equal(fatToolResultSeverity(FAT_TOOL_RESULT_TOKENS), undefined);
  assert.equal(fatToolResultSeverity(FAT_TOOL_RESULT_TOKENS + 1), "warn");
  assert.equal(fatToolResultSeverity(FAT_TOOL_RESULT_TOKENS * 2), "critical");
});
