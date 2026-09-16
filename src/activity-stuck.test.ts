import assert from "node:assert/strict";
import test from "node:test";
import { STUCK_MS, formatStuckLabel, isActivityStuck } from "./activity-stuck.js";

test("isActivityStuck：running 超過閾值才 true", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  assert.equal(
    isActivityStuck({
      activity: { toolName: "Read", phase: "running", at: new Date(now - STUCK_MS - 1000).toISOString() },
      now,
    }),
    true,
  );
  assert.equal(
    isActivityStuck({
      activity: { toolName: "Read", phase: "running", at: new Date(now - STUCK_MS + 1000).toISOString() },
      now,
    }),
    false,
  );
});

test("isActivityStuck：等待中／done／缺活動不算卡住", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  const old = new Date(now - STUCK_MS - 1000).toISOString();
  assert.equal(
    isActivityStuck({ activity: { toolName: "AskUserQuestion", phase: "running", at: old }, now }),
    false,
  );
  assert.equal(
    isActivityStuck({ activity: { toolName: "ExitPlanMode", phase: "running", at: old }, now }),
    false,
  );
  assert.equal(isActivityStuck({ activity: { toolName: "Read", phase: "done", at: old }, now }), false);
  assert.equal(isActivityStuck({ activity: undefined, now }), false);
});

test("formatStuckLabel：未滿 60s 用秒，否則用分", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  assert.equal(formatStuckLabel(new Date(now - 45_000).toISOString(), now), "可能卡住（已 45s）");
  assert.equal(formatStuckLabel(new Date(now - 120_000).toISOString(), now), "可能卡住（已 2m）");
});
