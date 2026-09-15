import assert from "node:assert/strict";
import test from "node:test";
import { applyJournalToPhases, parseJournalEvents } from "./journal.js";

const PHASES = ["Fetch Ticket + Write Plan", "Self-Grill", "Execute Plan", "Gate", "Push & Open PR"];

test("parseJournalEvents 略過壞行，只收 started 與 result", () => {
  const events = parseJournalEvents(
    [
      '{"type":"launched"}',
      "not json",
      '{"type":"started","key":"k1","phase":"Self-Grill"}',
      '{"type":"result","key":"k1","phase":"Self-Grill"}',
    ].join("\n"),
  );
  assert.deepEqual(events, [
    { type: "started", key: "k1", phase: "Self-Grill" },
    { type: "result", key: "k1", phase: "Self-Grill" },
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
