import assert from "node:assert/strict";
import test from "node:test";
import {
  pickPreferredSession,
  sessionChoices,
  shouldAutoSelectSession,
} from "./session-preference.js";

const sessions = [
  { sessionId: "old", cwd: "/proj/a", updatedAt: "2026-09-15T01:00:00.000Z" },
  { sessionId: "current", cwd: "/proj/b", updatedAt: "2026-09-15T02:00:00.000Z" },
  { sessionId: "newer-other", cwd: "/proj/c", updatedAt: "2026-09-15T03:00:00.000Z" },
];

test("pickPreferredSession 優先選 watch cwd 對得上、且最新的 session", () => {
  assert.equal(pickPreferredSession(sessions, "/proj/b"), "current");
  assert.equal(
    pickPreferredSession(
      [
        { sessionId: "older-b", cwd: "/proj/b", updatedAt: "2026-09-15T01:00:00.000Z" },
        { sessionId: "newer-b", cwd: "/proj/b", updatedAt: "2026-09-15T04:00:00.000Z" },
      ],
      "/proj/b",
    ),
    "newer-b",
  );
});

test("pickPreferredSession 沒有 cwd 對得上時改選全域最新", () => {
  assert.equal(pickPreferredSession(sessions, "/elsewhere"), "newer-other");
});

test("shouldAutoSelectSession 只有一個、或 cwd 對得上時自動選", () => {
  assert.equal(shouldAutoSelectSession(sessions.slice(0, 1), "/proj/a"), true);
  assert.equal(shouldAutoSelectSession(sessions, "/proj/b"), true);
  assert.equal(shouldAutoSelectSession(sessions, "/elsewhere"), false);
});

test("sessionChoices 把當下 session 放第一列並標 目前", () => {
  const items = sessionChoices(sessions, "/proj/b");
  assert.equal(items[0].value, "current");
  assert.equal(items[0].label, "current  (目前 · b)");
  assert.ok(items.some((item) => item.value === "newer-other" && item.label === "newer-other  (c)"));
});

test("sessionChoices 沒有 cwd 對得上時，最新的標 最近", () => {
  const items = sessionChoices(sessions, "/elsewhere");
  assert.equal(items[0].value, "newer-other");
  assert.equal(items[0].label, "newer-other  (最近 · c)");
});
