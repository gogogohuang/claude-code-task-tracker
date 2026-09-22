import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusOverview, focusLineColor, formatFocusLine, type FocusInput } from "./focus-overview.js";
import type { Advice } from "./usage/types.js";

function advice(summary: string, action: string, severity: Advice["severity"]): Advice {
  return { sessionId: "s", kind: "cache-spike", at: "t", severity, summary, action };
}

function row(sessionId: string, presence: FocusInput["presence"], adv?: Advice): FocusInput {
  return { sessionId, label: `proj · ${sessionId}`, agent: "claude", presence, advice: adv };
}

test("buildFocusOverview：presence idle 且沒有 advice 的 session 被濾掉", () => {
  const rows = buildFocusOverview([row("a", "idle"), row("b", "waiting")]);
  assert.deepEqual(rows.map((r) => r.sessionId), ["b"]);
});

test("buildFocusOverview：presence idle 但有 advice 仍保留", () => {
  const rows = buildFocusOverview([row("a", "idle", advice("s", "a", "warn"))]);
  assert.deepEqual(rows.map((r) => r.sessionId), ["a"]);
});

test("buildFocusOverview：排序＝等你 < critical advice < warn advice < 忙碌無 advice", () => {
  const rows = buildFocusOverview([
    row("busy-no-advice", "busy"),
    row("warn-advice", "idle", advice("s", "a", "warn")),
    row("waiting", "waiting"),
    row("critical-advice", "busy", advice("s", "a", "critical")),
  ]);
  assert.deepEqual(rows.map((r) => r.sessionId), ["waiting", "critical-advice", "warn-advice", "busy-no-advice"]);
});

test("buildFocusOverview：不改動輸入陣列", () => {
  const original = [row("b", "waiting"), row("a", "busy")];
  buildFocusOverview(original);
  assert.deepEqual(original.map((r) => r.sessionId), ["b", "a"]);
});

test("formatFocusLine：有 advice 顯示 severity icon + summary → action", () => {
  const line = formatFocusLine(row("a", "busy", advice("重算了 30K token", "現在 /clear", "critical")));
  assert.match(line, /^● /);
  assert.match(line, /✗ 重算了 30K token → 現在 \/clear$/);
});

test("formatFocusLine：沒有 advice 只顯示 presence 短標籤", () => {
  assert.match(formatFocusLine(row("a", "waiting")), /^! .*等你$/);
  assert.match(formatFocusLine(row("a", "busy")), /^● .*進行中$/);
});

test("focusLineColor：有 advice 依 severity，沒有 advice 依 presence", () => {
  assert.equal(focusLineColor(row("a", "busy", advice("s", "a", "critical"))), "red");
  assert.equal(focusLineColor(row("a", "busy", advice("s", "a", "warn"))), "yellow");
  assert.equal(focusLineColor(row("a", "waiting")), "red");
  assert.equal(focusLineColor(row("a", "busy")), "yellow");
});
