import assert from "node:assert/strict";
import test from "node:test";
import { formatAdviceForClipboard } from "./advice-export.js";
import { Advice, createSessionUsageStats, SessionUsageStats } from "./types.js";

function statsFixture(overrides: Partial<SessionUsageStats> = {}): SessionUsageStats {
  return {
    ...createSessionUsageStats("session-aaa11111"),
    sessionStartedAt: "2026-09-15T00:00:00.000Z",
    lastMsgAt: "2026-09-15T01:30:00.000Z",
    mainThreadMsgCount: 42,
    workTokensTotal: 120_000,
    ...overrides,
  };
}

test("formatAdviceForClipboard 沒有建議時輸出 session 資訊與提示", () => {
  const text = formatAdviceForClipboard(statsFixture(), []);
  assert.match(text, /session-aaa11111/);
  assert.match(text, /agent：claude/);
  assert.match(text, /目前沒有用量建議。/);
});

test("formatAdviceForClipboard 依 kind 分組並附合併後的次數/累積量", () => {
  const advice: Advice[] = [
    {
      sessionId: "session-aaa11111",
      kind: "fat-tool-result",
      at: "2026-09-15T01:00:00.000Z",
      severity: "warn",
      summary: "first",
      action: "act-1",
      target: "src/foo.ts",
      estTokens: 9000,
    },
    {
      sessionId: "session-aaa11111",
      kind: "fat-tool-result",
      at: "2026-09-15T01:10:00.000Z",
      severity: "critical",
      summary: "second",
      action: "act-2",
      target: "src/foo.ts",
      estTokens: 20000,
    },
    {
      sessionId: "session-aaa11111",
      kind: "long-session",
      at: "2026-09-15T01:20:00.000Z",
      severity: "warn",
      summary: "third",
      action: "act-3",
    },
  ];
  const text = formatAdviceForClipboard(statsFixture(), advice);
  // fat-tool-result 組內有一筆 critical，組排序優先於 long-session（全 warn）。
  assert.match(text, /共 3 則：fat-tool-result 2 · long-session 1/);
  assert.match(text, /## fat-tool-result · 2 則/);
  assert.match(text, /second（×2 次，累積約 29K token）/);
  assert.match(text, /## long-session · 1 則/);
  assert.match(text, /third/);
});

test("formatAdviceForClipboard 沒有 workTokensTotal 時不輸出那一行", () => {
  const text = formatAdviceForClipboard(statsFixture({ workTokensTotal: undefined }), []);
  assert.doesNotMatch(text, /累積新增工作量/);
});
