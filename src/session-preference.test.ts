import assert from "node:assert/strict";
import test from "node:test";
import {
  addedSessionIds,
  formatNewSessionNotice,
  groupSessionsByProject,
  pickPreferredSession,
  projectChoices,
  sessionChoices,
  sessionChoicesInProject,
  shortSessionId,
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

test("groupSessionsByProject 依 cwd 分組，當下專案排第一", () => {
  const groups = groupSessionsByProject(
    [
      ...sessions,
      { sessionId: "b2", cwd: "/proj/b", updatedAt: "2026-09-15T01:30:00.000Z" },
      { sessionId: "orphan", updatedAt: "2026-09-15T00:00:00.000Z" },
    ],
    "/proj/b",
  );
  assert.deepEqual(
    groups.map((group) => `${group.label}:${group.sessions.map((s) => s.sessionId).join(",")}`),
    ["b:current,b2", "c:newer-other", "a:old", "未知專案:orphan"],
  );
});

test("projectChoices 標出目前專案與 session 數", () => {
  const items = projectChoices(sessions, "/proj/b");
  assert.equal(items[0].label, "b  (1 · 目前)");
  assert.equal(items[0].value, "/proj/b");
  assert.ok(items.some((item) => item.label === "c  (1)"));
});

test("sessionChoicesInProject 只列出該專案，不再重複專案名", () => {
  const items = sessionChoicesInProject(
    [
      { sessionId: "older-b", cwd: "/proj/b", updatedAt: "2026-09-15T01:00:00.000Z" },
      { sessionId: "newer-b", cwd: "/proj/b", updatedAt: "2026-09-15T04:00:00.000Z" },
    ],
    "/proj/b",
    "/proj/b",
  );
  assert.equal(items[0].value, "newer-b");
  assert.equal(items[0].label, "newer-b  (目前)");
  assert.equal(items[1].label, "older-b");
});

test("addedSessionIds 只回新出現的 id，刪除不算新增", () => {
  assert.deepEqual(addedSessionIds(["a"], ["a", "b"]), ["b"]);
  assert.deepEqual(addedSessionIds(["a", "b"], ["a"]), []);
  assert.deepEqual(addedSessionIds([], ["a"]), ["a"]);
});

test("shortSessionId 超過 8 碼才截斷，否則原樣回傳", () => {
  assert.equal(shortSessionId("abcdefgh12345"), "abcdefgh");
  assert.equal(shortSessionId("short"), "short");
});

test("formatNewSessionNotice 帶專案名與回到列表提示", () => {
  assert.equal(
    formatNewSessionNotice([{ sessionId: "e9efe088-e33b", cwd: "/proj/taxigo_console" }]),
    "偵測到新 session：taxigo_console · e9efe088 — 按 b 回列表",
  );
  assert.equal(
    formatNewSessionNotice([
      { sessionId: "one", cwd: "/proj/a" },
      { sessionId: "two", cwd: "/proj/b" },
    ]),
    "偵測到 2 個新 session — 按 b 回列表",
  );
  assert.equal(
    formatNewSessionNotice([{ sessionId: "abc12345-rest" }]),
    "偵測到新 session：abc12345 — 按 b 回列表",
  );
});

