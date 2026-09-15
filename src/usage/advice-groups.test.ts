import assert from "node:assert/strict";
import test from "node:test";
import { Advice } from "./types.js";
import { adviceForSession } from "./advice-groups.js";

const advice: Advice[] = [
  { sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:00:00.000Z", message: "old" },
  { sessionId: "session-bbb22222", kind: "cache-spike", at: "2026-09-15T02:00:00.000Z", message: "other" },
  { sessionId: "session-aaa11111", kind: "cache-spike", at: "2026-09-15T01:05:00.000Z", message: "new" },
];

test("adviceForSession 只留 selected session，依時間新到舊", () => {
  const filtered = adviceForSession(advice, "session-aaa11111");
  assert.deepEqual(
    filtered.map((item) => item.message),
    ["new", "old"],
  );
});

test("adviceForSession 在 sessionId 為 undefined 時回空陣列", () => {
  assert.deepEqual(adviceForSession(advice, undefined), []);
});

test("adviceForSession 沒有該 session 的建議時回空陣列", () => {
  assert.deepEqual(adviceForSession(advice, "missing"), []);
});
