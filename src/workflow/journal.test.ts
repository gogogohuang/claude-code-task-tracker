import assert from "node:assert/strict";
import test from "node:test";
import { applyJournalToPhases, parseJournalEvents, summarizeJournalResult } from "./journal.js";

const PHASES = ["Fetch Ticket + Write Plan", "Self-Grill", "Execute Plan", "Gate", "Push & Open PR"];

test("parseJournalEvents 略過壞行，只收 started 與 result", () => {
  const events = parseJournalEvents(
    [
      '{"type":"launched"}',
      "not json",
      '{"type":"started","key":"k1","phase":"Self-Grill","label":"self-grill"}',
      '{"type":"result","key":"k1","phase":"Self-Grill","result":{"summary":"ok plan"}}',
    ].join("\n"),
  );
  assert.deepEqual(events, [
    { type: "started", key: "k1", phase: "Self-Grill", label: "self-grill" },
    {
      type: "result",
      key: "k1",
      phase: "Self-Grill",
      result: { summary: "ok plan" },
    },
  ]);
});

test("summarizeJournalResult 取字串第一行或物件 summary，超過 48 字截斷", () => {
  assert.equal(summarizeJournalResult("第一行\n第二行"), "第一行");
  assert.equal(summarizeJournalResult({ summary: "短摘要" }), "短摘要");
  assert.equal(summarizeJournalResult({ status: "DONE" }), "DONE");
  assert.equal(summarizeJournalResult({ error: "boom" }), "boom");
  const long = "x".repeat(60);
  assert.equal(summarizeJournalResult(long), `${"x".repeat(48)}…`);
  assert.equal(summarizeJournalResult(null), undefined);
});

test("applyJournalToPhases 在 phase 下列出 step label 與短摘要", () => {
  const phases = applyJournalToPhases(PHASES, [
    { type: "started", key: "a", phase: "Fetch Ticket + Write Plan", label: "write-plan" },
    {
      type: "result",
      key: "a",
      phase: "Fetch Ticket + Write Plan",
      result: { summary: "Drafted a single-task plan to fix timezone" },
    },
    { type: "started", key: "b", phase: "Self-Grill", label: "self-grill" },
  ]);
  const fetch = phases.find((row) => row.title === "Fetch Ticket + Write Plan");
  assert.deepEqual(fetch?.steps, [
    {
      key: "a",
      label: "write-plan",
      status: "completed",
      summary: "Drafted a single-task plan to fix timezone",
    },
  ]);
  const grill = phases.find((row) => row.title === "Self-Grill");
  assert.deepEqual(grill?.steps, [
    { key: "b", label: "self-grill", status: "in_progress" },
  ]);
});

test("applyJournalToPhases 依 started/result 標 pending in_progress completed", () => {
  const phases = applyJournalToPhases(PHASES, [
    { type: "started", key: "a", phase: "Fetch Ticket + Write Plan" },
    { type: "result", key: "a", phase: "Fetch Ticket + Write Plan" },
    { type: "started", key: "b", phase: "Self-Grill" },
  ]);
  assert.deepEqual(
    phases.map((row) => `${row.title}:${row.status}`),
    [
      "Fetch Ticket + Write Plan:completed",
      "Self-Grill:in_progress",
      "Execute Plan:pending",
      "Gate:pending",
      "Push & Open PR:pending",
    ],
  );
});

test("applyJournalToPhases 把 ▸ 巢狀 phase 算進最近的父 phase", () => {
  const phases = applyJournalToPhases(PHASES, [
    { type: "started", key: "a", phase: "Execute Plan" },
    { type: "result", key: "a", phase: "Execute Plan" },
    { type: "started", key: "b", phase: "▸ linego-plan-execute-workflow" },
  ]);
  assert.equal(phases.find((row) => row.title === "Execute Plan")?.status, "in_progress");
  assert.ok(phases.every((row) => !row.title.startsWith("▸")));
});

test("applyJournalToPhases 後面 phase 已開始時，前面還沒事件的視為已完成", () => {
  const phases = applyJournalToPhases(PHASES, [
    { type: "started", key: "a", phase: "Execute Plan" },
  ]);
  assert.equal(phases[0].status, "completed");
  assert.equal(phases[1].status, "completed");
  assert.equal(phases[2].status, "in_progress");
});

test("applyJournalToPhases 的 result 沒帶 phase 時，用最近的父 phase", () => {
  const phases = applyJournalToPhases(PHASES, [
    { type: "started", key: "a", phase: "Self-Grill" },
    { type: "result", key: "a", phase: "" },
  ]);
  assert.equal(phases.find((row) => row.title === "Self-Grill")?.status, "completed");
});
