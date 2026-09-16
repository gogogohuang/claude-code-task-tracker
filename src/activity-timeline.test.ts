import assert from "node:assert/strict";
import test from "node:test";
import { TIMELINE_MAX, pushActivityToTimeline, type TimelineEntry } from "./activity-timeline.js";

const running = (toolName: string, at: string, summary?: string): TimelineEntry => ({
  toolName,
  phase: "running",
  at,
  summary,
});

const done = (toolName: string, at: string, summary?: string): TimelineEntry => ({
  toolName,
  phase: "done",
  at,
  summary,
});

test("pushActivityToTimeline：undefined 不變", () => {
  assert.deepEqual(pushActivityToTimeline([running("Read", "t1")], undefined), [running("Read", "t1")]);
});

test("pushActivityToTimeline：running append", () => {
  assert.deepEqual(pushActivityToTimeline([], running("Read", "t1", "正在讀取 a")), [
    running("Read", "t1", "正在讀取 a"),
  ]);
});

test("pushActivityToTimeline：同 tool done 覆寫最新 running", () => {
  const prev = [running("Bash", "t0"), running("Read", "t1", "正在讀取 a")];
  assert.deepEqual(pushActivityToTimeline(prev, done("Read", "t2", "已讀取 a")), [
    running("Bash", "t0"),
    done("Read", "t2", "已讀取 a"),
  ]);
});

test("pushActivityToTimeline：不同 tool 的 done 直接 append", () => {
  const prev = [running("Read", "t1")];
  assert.deepEqual(pushActivityToTimeline(prev, done("Bash", "t2")), [
    running("Read", "t1"),
    done("Bash", "t2"),
  ]);
});

test("pushActivityToTimeline：同 at+phase 不重複", () => {
  const prev = [running("Read", "t1")];
  assert.deepEqual(pushActivityToTimeline(prev, running("Read", "t1")), prev);
});

test("pushActivityToTimeline：超過上限丟最舊", () => {
  let entries: TimelineEntry[] = [];
  for (let i = 0; i < TIMELINE_MAX + 5; i++) {
    entries = pushActivityToTimeline(entries, running(`T${i}`, `t${i}`));
  }
  assert.equal(entries.length, TIMELINE_MAX);
  assert.equal(entries[0]?.toolName, "T5");
  assert.equal(entries.at(-1)?.toolName, `T${TIMELINE_MAX + 4}`);
});
