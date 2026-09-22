import assert from "node:assert/strict";
import test from "node:test";
import { Advice } from "./types.js";
import { adviceForSession } from "./advice-groups.js";

const advice: Advice[] = [
  { sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:00:00.000Z", severity: "warn", summary: "old", action: "act-old" },
  { sessionId: "session-bbb22222", kind: "cache-spike", at: "2026-09-15T02:00:00.000Z", severity: "warn", summary: "other", action: "act-other" },
  { sessionId: "session-aaa11111", kind: "cache-spike", at: "2026-09-15T01:05:00.000Z", severity: "warn", summary: "new", action: "act-new" },
];

test("adviceForSession 只留 selected session，依時間新到舊", () => {
  const filtered = adviceForSession(advice, "session-aaa11111");
  assert.deepEqual(
    filtered.map((item) => item.summary),
    ["new", "old"],
  );
});

test("adviceForSession 在 sessionId 為 undefined 時回空陣列", () => {
  assert.deepEqual(adviceForSession(advice, undefined), []);
});

test("adviceForSession 沒有該 session 的建議時回空陣列", () => {
  assert.deepEqual(adviceForSession(advice, "missing"), []);
});

test("adviceForSession 先依 severity（critical 在前）排序，同 severity 才依時間新到舊", () => {
  const mixed: Advice[] = [
    { sessionId: "s1", kind: "long-session", at: "2026-09-15T03:00:00.000Z", severity: "warn", summary: "warn-newest", action: "a" },
    { sessionId: "s1", kind: "cache-spike", at: "2026-09-15T01:00:00.000Z", severity: "critical", summary: "critical-older", action: "a" },
    { sessionId: "s1", kind: "heavy-baseline", at: "2026-09-15T02:00:00.000Z", severity: "critical", summary: "critical-newer", action: "a" },
  ];
  const filtered = adviceForSession(mixed, "s1");
  assert.deepEqual(
    filtered.map((item) => item.summary),
    ["critical-newer", "critical-older", "warn-newest"],
  );
});
