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
  const now = Date.parse("2026-09-15T03:00:00.000Z");
  const items = sessionChoices(sessions, "/proj/b", now);
  assert.equal(items[0].value, "current");
  assert.equal(items[0].label, "current  (目前) · 1 小時前");
  assert.ok(items.some((item) => item.value === "newer-other" && item.label === "newer-ot · 剛剛"));
});

test("sessionChoices 沒有 cwd 對得上時，最新的標 最近", () => {
  const now = Date.parse("2026-09-15T03:00:00.000Z");
  const items = sessionChoices(sessions, "/elsewhere", now);
  assert.equal(items[0].value, "newer-other");
  assert.equal(items[0].label, "newer-ot  (最近) · 剛剛");
});

test("groupSessionsByProject 依 cwd 分組，當下專案排第一，略過沒有 cwd 的 session", () => {
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
    ["b:current,b2", "c:newer-other", "a:old"],
  );
});

test("projectChoices 不列出沒有 cwd 的未知專案", () => {
  const items = projectChoices(
    [...sessions, { sessionId: "orphan", updatedAt: "2026-09-15T00:00:00.000Z" }],
    "/proj/b",
  );
  assert.equal(items.every((item) => !item.label.includes("未知專案")), true);
  assert.equal(items.some((item) => item.value === ""), false);
});

test("projectChoices 標出目前專案與 session 數", () => {
  const items = projectChoices(sessions, "/proj/b");
  assert.equal(items[0].label, "b  (1 · 目前)");
  assert.equal(items[0].value, "/proj/b");
  assert.ok(items.some((item) => item.label === "c  (1)"));
});

test("pickPreferredSession 與 shouldAutoSelectSession 略過沒有 cwd 的 session", () => {
  const withOrphan = [
    { sessionId: "orphan", updatedAt: "2026-09-15T09:00:00.000Z" },
    ...sessions,
  ];
  assert.equal(pickPreferredSession(withOrphan, "/elsewhere"), "newer-other");
  assert.equal(pickPreferredSession([{ sessionId: "orphan", updatedAt: "t" }], "/proj/a"), undefined);
  assert.equal(shouldAutoSelectSession([{ sessionId: "orphan", updatedAt: "t" }], "/proj/a"), false);
});

test("sessionChoicesInProject 只列出該專案，不再重複專案名", () => {
  const now = Date.parse("2026-09-15T04:00:00.000Z");
  const items = sessionChoicesInProject(
    [
      { sessionId: "older-b", cwd: "/proj/b", updatedAt: "2026-09-15T01:00:00.000Z" },
      { sessionId: "newer-b", cwd: "/proj/b", updatedAt: "2026-09-15T04:00:00.000Z" },
    ],
    "/proj/b",
    "/proj/b",
    now,
  );
  assert.equal(items[0].value, "newer-b");
  assert.equal(items[0].label, "newer-b  (目前) · 剛剛");
  assert.equal(items[1].label, "older-b · 3 小時前");
});

test("sessionChoicesInProject 短 ID、標題、活動、缺欄省略、32 字截斷", () => {
  const now = Date.parse("2026-09-15T02:03:00.000Z");
  const longTitle = "這是一段超過三十二個字元的標題所以應該被截斷XXXXXXXXXXX";
  assert.ok(longTitle.length > 32);
  const items = sessionChoicesInProject(
    [
      {
        sessionId: "e9efe088-e33b-rest",
        cwd: "/proj/b",
        updatedAt: "2026-09-15T02:00:00.000Z",
        title: "修用量面板",
        activitySummary: "正在讀取 src/schema.ts",
      },
      {
        sessionId: "aaaaaaaa-other",
        cwd: "/proj/b",
        updatedAt: "2026-09-15T01:00:00.000Z",
        firstPrompt: longTitle,
      },
    ],
    "/proj/b",
    "/proj/b",
    now,
  );
  assert.equal(
    items[0].label,
    "e9efe088  (目前) · 修用量面板 · 正在讀取 src/schema.ts · 3 分鐘前",
  );
  assert.equal(items[1].label, `aaaaaaaa · ${longTitle.slice(0, 32)}… · 1 小時前`);
});

test("sessionChoicesInProject 沒有標題時只顯示短 ID、活動與時間", () => {
  const now = Date.parse("2026-09-15T02:00:00.000Z");
  const items = sessionChoicesInProject(
    [
      {
        sessionId: "plain-id",
        cwd: "/proj/b",
        updatedAt: "2026-09-15T02:00:00.000Z",
        activitySummary: "正在讀取 src/schema.ts",
      },
    ],
    "/proj/b",
    "/proj/b",
    now,
  );
  assert.equal(items[0].label, "plain-id  (目前) · 正在讀取 src/schema.ts · 剛剛");
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

