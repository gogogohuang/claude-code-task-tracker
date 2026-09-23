import assert from "node:assert/strict";
import test from "node:test";
import { Advice } from "./types.js";
import { adviceForSession, adviceOverviewLine, formatAdviceGroupsLines, groupAdvice } from "./advice-groups.js";

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

test("groupAdvice 同 kind + 同 target 合併成一列，count 與 estTokensSum 正確加總", () => {
  const items: Advice[] = [
    {
      sessionId: "s1",
      kind: "fat-tool-result",
      at: "2026-09-15T01:00:00.000Z",
      severity: "warn",
      summary: "first",
      action: "a",
      target: "src/foo.ts",
      estTokens: 9000,
    },
    {
      sessionId: "s1",
      kind: "fat-tool-result",
      at: "2026-09-15T02:00:00.000Z",
      severity: "critical",
      summary: "second-latest",
      action: "b",
      target: "src/foo.ts",
      estTokens: 20000,
    },
  ];
  const groups = groupAdvice(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "fat-tool-result");
  assert.equal(groups[0].totalCount, 2);
  assert.equal(groups[0].rows.length, 1);
  const [row] = groups[0].rows;
  assert.equal(row.count, 2);
  assert.equal(row.estTokensSum, 29000);
  assert.equal(row.severity, "critical");
  assert.equal(row.summary, "second-latest");
});

test("groupAdvice 沒有 target 的項目各自成一列，不合併", () => {
  const items: Advice[] = [
    { sessionId: "s1", kind: "long-session", at: "2026-09-15T01:00:00.000Z", severity: "warn", summary: "a", action: "a" },
    { sessionId: "s1", kind: "long-session", at: "2026-09-15T02:00:00.000Z", severity: "warn", summary: "b", action: "a" },
  ];
  const groups = groupAdvice(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].totalCount, 2);
  assert.equal(groups[0].rows.length, 2);
  assert.ok(groups[0].rows.every((row) => row.count === 1));
});

test("groupAdvice 不同 target 各自成一列", () => {
  const items: Advice[] = [
    { sessionId: "s1", kind: "repeated-read", at: "2026-09-15T01:00:00.000Z", severity: "warn", summary: "a", action: "a", target: "src/a.ts" },
    { sessionId: "s1", kind: "repeated-read", at: "2026-09-15T02:00:00.000Z", severity: "warn", summary: "b", action: "a", target: "src/b.ts" },
  ];
  const groups = groupAdvice(items);
  assert.equal(groups[0].rows.length, 2);
});

test("groupAdvice 組排序：含 critical 的 kind 排前面", () => {
  const items: Advice[] = [
    { sessionId: "s1", kind: "long-session", at: "2026-09-15T03:00:00.000Z", severity: "warn", summary: "a", action: "a" },
    { sessionId: "s1", kind: "cache-spike", at: "2026-09-15T01:00:00.000Z", severity: "critical", summary: "b", action: "a" },
  ];
  const groups = groupAdvice(items);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ["cache-spike", "long-session"],
  );
});

test("adviceOverviewLine 列出總筆數與各 kind 筆數", () => {
  const items: Advice[] = [
    { sessionId: "s1", kind: "fat-tool-result", at: "2026-09-15T01:00:00.000Z", severity: "warn", summary: "a", action: "a", target: "x" },
    { sessionId: "s1", kind: "fat-tool-result", at: "2026-09-15T02:00:00.000Z", severity: "warn", summary: "b", action: "a", target: "x" },
    { sessionId: "s1", kind: "long-session", at: "2026-09-15T03:00:00.000Z", severity: "warn", summary: "c", action: "a" },
  ];
  const groups = groupAdvice(items);
  // 兩組都是 warn，依組內最新時間排序：long-session 最新一筆（03:00）比 fat-tool-result 最新一筆（02:00）更晚，排前面。
  assert.equal(adviceOverviewLine(groups), "共 3 則：long-session 1 · fat-tool-result 2");
});

test("formatAdviceGroupsLines 沒有建議時回空陣列", () => {
  assert.deepEqual(formatAdviceGroupsLines([]), []);
});

test("formatAdviceGroupsLines 依 kind 分組並附合併後的次數/累積量", () => {
  const items: Advice[] = [
    {
      sessionId: "s1",
      kind: "fat-tool-result",
      at: "2026-09-15T01:00:00.000Z",
      severity: "warn",
      summary: "first",
      action: "act-1",
      target: "src/foo.ts",
      estTokens: 9000,
    },
    {
      sessionId: "s1",
      kind: "fat-tool-result",
      at: "2026-09-15T01:10:00.000Z",
      severity: "critical",
      summary: "second",
      action: "act-2",
      target: "src/foo.ts",
      estTokens: 20000,
    },
    {
      sessionId: "s1",
      kind: "long-session",
      at: "2026-09-15T01:20:00.000Z",
      severity: "warn",
      summary: "third",
      action: "act-3",
      detailLines: ["detail-1"],
    },
  ];
  const lines = formatAdviceGroupsLines(items).join("\n");
  assert.match(lines, /共 3 則：fat-tool-result 2 · long-session 1/);
  assert.match(lines, /## fat-tool-result · 2 則/);
  assert.match(lines, /✗ second（×2 次，累積約 29K token）/);
  assert.match(lines, /  → act-2/);
  assert.match(lines, /## long-session · 1 則/);
  assert.match(lines, /⚠ third/);
  assert.match(lines, /  · detail-1/);
});
