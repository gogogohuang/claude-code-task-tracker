import assert from "node:assert/strict";
import test from "node:test";
import {
  alertEdgeKey,
  collectAlertEvents,
  formatAlertBanner,
  nextJumpTarget,
  shouldRingAlertBell,
  type AlertEvent,
  type AlertSessionSnapshot,
} from "./session-alerts.js";

const waiting = (sessionId: string, at = "2026-09-17T10:00:00.000Z"): AlertSessionSnapshot => ({
  sessionId,
  activity: { toolName: "AskUserQuestion", phase: "running", at },
  latestUnreadAdviceAt: undefined,
});

test("collectAlertEvents 排除目前 session", () => {
  const events = collectAlertEvents({
    sessions: [waiting("a"), waiting("b")],
    selectedSessionId: "a",
  });
  assert.deepEqual(
    events.map((e) => e.sessionId),
    ["b"],
  );
});

test("waiting 優先於 advice；同 kind 較新在前", () => {
  const sessions: AlertSessionSnapshot[] = [
    {
      sessionId: "adv-old",
      activity: { toolName: "Read", phase: "done", at: "t" },
      latestUnreadAdviceAt: "2026-09-17T12:00:00.000Z",
    },
    {
      sessionId: "wait-new",
      activity: { toolName: "AskUserQuestion", phase: "running", at: "2026-09-17T11:00:00.000Z" },
    },
    {
      sessionId: "wait-old",
      activity: { toolName: "ExitPlanMode", phase: "running", at: "2026-09-17T09:00:00.000Z" },
    },
    {
      sessionId: "adv-new",
      activity: undefined,
      latestUnreadAdviceAt: "2026-09-17T13:00:00.000Z",
    },
  ];
  const events = collectAlertEvents({ sessions, selectedSessionId: undefined });
  assert.deepEqual(
    events.map((e) => `${e.kind}:${e.sessionId}`),
    ["waiting:wait-new", "waiting:wait-old", "advice:adv-new", "advice:adv-old"],
  );
});

test("nextJumpTarget 取排序後第一則", () => {
  const events: AlertEvent[] = [
    {
      sessionId: "w",
      kind: "waiting",
      at: "t",
      edgeKey: alertEdgeKey("w", "waiting", "t"),
    },
    {
      sessionId: "a",
      kind: "advice",
      at: "t2",
      edgeKey: alertEdgeKey("a", "advice", "t2"),
    },
  ];
  assert.deepEqual(nextJumpTarget(events), { sessionId: "w", kind: "waiting" });
  assert.equal(nextJumpTarget([]), undefined);
});

test("formatAlertBanner 文案", () => {
  assert.equal(formatAlertBanner([]), undefined);
  assert.equal(
    formatAlertBanner([
      { sessionId: "e9efe088-aaaa", kind: "waiting", at: "t", edgeKey: "k" },
    ]),
    "e9efe088 正在等你 · 按 n 跳轉",
  );
  assert.equal(
    formatAlertBanner([
      { sessionId: "a", kind: "waiting", at: "t", edgeKey: "k1" },
      { sessionId: "b", kind: "waiting", at: "t", edgeKey: "k2" },
    ]),
    "2 個 session 在等你 · 按 n 跳轉",
  );
  assert.equal(
    formatAlertBanner([
      { sessionId: "e9efe088-aaaa", kind: "advice", at: "t", edgeKey: "k" },
    ]),
    "用量建議 · e9efe088 · 按 n 查看",
  );
  assert.equal(
    formatAlertBanner([
      { sessionId: "a", kind: "advice", at: "t", edgeKey: "k1" },
      { sessionId: "b", kind: "advice", at: "t", edgeKey: "k2" },
    ]),
    "有 2 則跨 session 用量建議 · 按 n 查看",
  );
  assert.match(
    formatAlertBanner([
      { sessionId: "w", kind: "waiting", at: "t", edgeKey: "k1" },
      { sessionId: "a", kind: "advice", at: "t", edgeKey: "k2" },
    ])!,
    /正在等你|個 session 在等你/,
  );
});

test("shouldRingAlertBell 同 edge 不響", () => {
  assert.equal(shouldRingAlertBell(undefined, "a"), true);
  assert.equal(shouldRingAlertBell("a", "a"), false);
  assert.equal(shouldRingAlertBell("a", "b"), true);
  assert.equal(shouldRingAlertBell("a", undefined), false);
});
