import assert from "node:assert/strict";
import test from "node:test";
import {
  addedSessionIds,
  filterListableSessionIds,
  filterSessionsByAgent,
  formatNewSessionNotice,
  groupSessionsByProject,
  normalizeOptionalCwd,
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

test("sessionChoices 缺 title／activity 不留空洞分隔", () => {
  const now = Date.parse("2026-09-15T03:00:00.000Z");
  const items = sessionChoices(
    [{ sessionId: "only-id", cwd: "/proj/a", updatedAt: "2026-09-15T03:00:00.000Z" }],
    "/proj/a",
    now,
  );
  assert.equal(items[0]!.label, "○ only-id  (目前) · 剛剛");
  assert.equal(items[0]!.label.includes(" · · "), false);
});

test("sessionChoices 過長 activity 截斷", () => {
  const now = Date.parse("2026-09-15T03:00:00.000Z");
  const long = "x".repeat(80);
  const items = sessionChoices(
    [
      {
        sessionId: "s1",
        cwd: "/proj/a",
        updatedAt: "2026-09-15T03:00:00.000Z",
        activitySummary: long,
      },
    ],
    "/proj/a",
    now,
  );
  assert.match(items[0]!.label, /…/);
  assert.ok(!items[0]!.label.includes(long));
});

test("sessionChoices 沒有 cwd 對得上時，最新的標 最近（但列表順序仍照字母排序，不會跳到最前面）", () => {
  const now = Date.parse("2026-09-15T03:00:00.000Z");
  const items = sessionChoices(sessions, "/elsewhere", now);
  assert.deepEqual(
    items.map((item) => item.value),
    ["current", "newer-other", "old"],
  );
  assert.equal(items[1].label, "○ newer-ot  (最近) · 剛剛");
});

test("sessionChoices 依標題／firstPrompt／sessionId 字母排序，不受 updatedAt 影響", () => {
  const now = Date.parse("2026-09-15T03:00:00.000Z");
  const items = sessionChoices(
    [
      { sessionId: "z-id", cwd: "/proj/a", updatedAt: "2026-09-15T03:00:00.000Z", title: "Apple" },
      { sessionId: "a-id", cwd: "/proj/a", updatedAt: "2026-09-15T01:00:00.000Z", title: "Banana" },
    ],
    "/elsewhere",
    now,
  );
  assert.deepEqual(
    items.map((item) => item.value),
    ["z-id", "a-id"],
  );
});

test("groupSessionsByProject 依 cwd 分組，當下專案排第一；無 cwd 不進列表", () => {
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
  assert.ok(!groups.some((group) => group.label === "未知專案"));
});

test("projectChoices 不列出沒有 cwd 的未知專案", () => {
  const items = projectChoices(
    [...sessions, { sessionId: "orphan", updatedAt: "2026-09-15T00:00:00.000Z" }],
    "/proj/b",
  );
  assert.ok(!items.some((item) => item.label.includes("未知專案") || item.value === ""));
});

test("projectChoices 標出目前專案與 session 數", () => {
  const items = projectChoices(sessions, "/proj/b");
  assert.equal(items[0].label, "○ b  (1 · 目前)");
  assert.equal(items[0].value, "/proj/b");
  assert.ok(items.some((item) => item.label === "○ c  (1)"));
});

test("session／專案 label 前綴反映 presence（! 等你、● 忙碌、○ 閒置）", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  const waiting = sessionChoicesInProject(
    [
      {
        sessionId: "wait-1",
        cwd: "/proj/b",
        updatedAt: "2026-09-16T11:59:55.000Z",
        activityToolName: "AskUserQuestion",
        activityPhase: "running",
      },
    ],
    "/proj/b",
    "/proj/b",
    now,
  );
  assert.ok(waiting[0].label.startsWith("! "));
  assert.equal(waiting[0].presence, "waiting");

  const busy = sessionChoicesInProject(
    [
      {
        sessionId: "busy-1",
        cwd: "/proj/b",
        updatedAt: "2026-09-16T11:59:55.000Z",
        activityToolName: "Read",
        activityPhase: "running",
      },
    ],
    "/proj/b",
    "/proj/b",
    now,
  );
  assert.ok(busy[0].label.startsWith("● "));
  assert.equal(busy[0].presence, "busy");

  const project = projectChoices(
    [
      {
        sessionId: "idle-1",
        cwd: "/proj/b",
        updatedAt: "2026-09-16T11:00:00.000Z",
        activityToolName: "Read",
        activityPhase: "done",
      },
      {
        sessionId: "wait-2",
        cwd: "/proj/b",
        updatedAt: "2026-09-16T11:59:55.000Z",
        activityToolName: "ExitPlanMode",
        activityPhase: "running",
      },
    ],
    "/proj/b",
    now,
  );
  assert.ok(project[0].label.startsWith("! "));
});

test("pickPreferredSession 與 shouldAutoSelectSession 略過沒有 cwd 的 session", () => {
  const withOrphan = [
    { sessionId: "orphan", updatedAt: "2026-09-15T09:00:00.000Z" },
    ...sessions,
  ];
  assert.equal(pickPreferredSession(withOrphan, "/elsewhere"), "newer-other");
  // 全部沒 cwd 時退回全域最新（status CLI）；TUI 仍不自動選
  assert.equal(pickPreferredSession([{ sessionId: "orphan", updatedAt: "t" }], "/proj/a"), "orphan");
  assert.equal(shouldAutoSelectSession([{ sessionId: "orphan", updatedAt: "t" }], "/proj/a"), false);
});

test("filterListableSessionIds 略過無 cwd 與空白 cwd", () => {
  const cwdById: Record<string, string | undefined> = {
    ok: "/proj/a",
    orphan: undefined,
    blank: "  ",
  };
  assert.deepEqual(
    filterListableSessionIds(["ok", "orphan", "blank", "missing"], (id) => cwdById[id]),
    ["ok"],
  );
});

test("空字串 cwd 視同沒有 cwd；無 cwd session 不進專案列表", () => {
  assert.equal(normalizeOptionalCwd(""), undefined);
  assert.equal(normalizeOptionalCwd("  "), undefined);
  assert.equal(normalizeOptionalCwd("/proj"), "/proj");
  assert.equal(
    pickPreferredSession(
      [{ sessionId: "empty-cwd", cwd: "", updatedAt: "2026-09-15T09:00:00.000Z" }],
      "/proj/a",
    ),
    "empty-cwd",
  );
  const groups = groupSessionsByProject(
    [{ sessionId: "orphan", cwd: "", updatedAt: "2026-09-15T09:00:00.000Z" }],
    "/proj/a",
  );
  assert.deepEqual(groups, []);
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
  assert.equal(items[0].label, "○ newer-b  (目前) · 剛剛");
  assert.equal(items[1].label, "○ older-b · 3 小時前");
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
    "○ e9efe088  (目前) · 修用量面板 · 正在讀取 src/schema.ts · 3 分鐘前",
  );
  assert.equal(items[1].label, `○ aaaaaaaa · ${longTitle.slice(0, 32)}… · 1 小時前`);
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
  assert.equal(items[0].label, "○ plain-id  (目前) · 正在讀取 src/schema.ts · 剛剛");
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


test("filterSessionsByAgent 依來源過濾，缺省視為 claude，cursor 目前必為空", () => {
  const mixed = [
    { sessionId: "a", cwd: "/p", updatedAt: "2026-09-19T01:00:00.000Z" },
    { sessionId: "b", cwd: "/p", updatedAt: "2026-09-19T01:00:00.000Z", agent: "codex" as const },
    { sessionId: "c", cwd: "/p", updatedAt: "2026-09-19T01:00:00.000Z", agent: "claude" as const },
  ];
  assert.deepEqual(filterSessionsByAgent(mixed, "claude").map((s) => s.sessionId), ["a", "c"]);
  assert.deepEqual(filterSessionsByAgent(mixed, "codex").map((s) => s.sessionId), ["b"]);
  assert.deepEqual(filterSessionsByAgent(mixed, "cursor"), []);
  assert.deepEqual(filterSessionsByAgent([], "claude"), []);
});
