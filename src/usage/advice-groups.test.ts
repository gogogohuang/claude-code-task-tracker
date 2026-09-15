import assert from "node:assert/strict";
import test from "node:test";
import { SessionHint } from "../session-preference.js";
import { Advice } from "./types.js";
import { groupAdviceByProject } from "./advice-groups.js";

const hints: SessionHint[] = [
  { sessionId: "session-aaa11111", cwd: "/proj/a", updatedAt: "2026-09-15T01:00:00.000Z", activitySummary: "正在讀取 src/foo.ts" },
  { sessionId: "session-bbb22222", cwd: "/proj/b", updatedAt: "2026-09-15T02:00:00.000Z" },
  { sessionId: "session-ccc33333", cwd: "/proj/a", updatedAt: "2026-09-15T03:00:00.000Z" },
];

test("groupAdviceByProject 只保留有 advice 的 session，依專案分組", () => {
  const advice: Advice[] = [
    { sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:05:00.000Z", message: "m1" },
    { sessionId: "session-ccc33333", kind: "fat-tool-result", at: "2026-09-15T03:05:00.000Z", message: "m3" },
  ];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "a");
  assert.equal(groups[0].sessions.length, 2);
  assert.equal(groups[0].sessions.every((s) => s.advice.length === 1), true);
});

test("groupAdviceByProject 帶出 shortId、isCurrent、activitySummary", () => {
  const advice: Advice[] = [{ sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:05:00.000Z", message: "m1" }];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  const session = groups[0].sessions[0];
  assert.equal(session.shortId, "session-");
  assert.equal(session.isCurrent, true);
  assert.equal(session.activitySummary, "正在讀取 src/foo.ts");
});

test("groupAdviceByProject 不是目前 cwd 的 session，isCurrent 是 false", () => {
  const advice: Advice[] = [{ sessionId: "session-bbb22222", kind: "cache-spike", at: "2026-09-15T02:05:00.000Z", message: "m2" }];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  assert.equal(groups[0].sessions[0].isCurrent, false);
});

test("groupAdviceByProject 同一個 session 的 advice 依時間新到舊排序", () => {
  const advice: Advice[] = [
    { sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:00:00.000Z", message: "old" },
    { sessionId: "session-aaa11111", kind: "cache-spike", at: "2026-09-15T01:05:00.000Z", message: "new" },
  ];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  const session = groups[0].sessions.find((s) => s.sessionId === "session-aaa11111");
  assert.equal(session?.advice[0].message, "new");
});
