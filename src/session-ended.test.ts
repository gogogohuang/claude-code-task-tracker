import assert from "node:assert/strict";
import test from "node:test";
import type { TaskState } from "./schema.js";
import { ENDED_MS, formatEndedSummary, isSessionEnded } from "./session-ended.js";
import type { Advice } from "./usage/types.js";

const base: TaskState = {
  sessionId: "s1",
  updatedAt: "2026-09-16T10:00:00.000Z",
};

const t0 = Date.parse(base.updatedAt);

test("ENDED_MS 為 5 分鐘", () => {
  assert.equal(ENDED_MS, 300_000);
});

test("未滿 5 分鐘 → false", () => {
  assert.equal(isSessionEnded(base, t0 + ENDED_MS - 1), false);
});

test("剛好 5 分鐘且無 running／in_progress → true", () => {
  assert.equal(isSessionEnded(base, t0 + ENDED_MS), true);
});

test("activity running → false", () => {
  assert.equal(
    isSessionEnded(
      {
        ...base,
        activity: { toolName: "Read", phase: "running", at: base.updatedAt },
      },
      t0 + ENDED_MS,
    ),
    false,
  );
});

test("activity done + 滿 5 分鐘 → true", () => {
  assert.equal(
    isSessionEnded(
      {
        ...base,
        activity: {
          toolName: "Read",
          phase: "done",
          summary: "正在讀取 x",
          at: base.updatedAt,
        },
      },
      t0 + ENDED_MS,
    ),
    true,
  );
});

test("in_progress task → false", () => {
  assert.equal(
    isSessionEnded(
      {
        ...base,
        tasks: { a: { id: "a", status: "in_progress", subject: "做 A" } },
      },
      t0 + ENDED_MS,
    ),
    false,
  );
});

test("in_progress todo → false", () => {
  assert.equal(
    isSessionEnded(
      {
        ...base,
        todos: [{ content: "做 B", status: "in_progress" }],
      },
      t0 + ENDED_MS,
    ),
    false,
  );
});

test("in_progress workflow phase → false", () => {
  assert.equal(
    isSessionEnded(
      {
        ...base,
        workflow: {
          runId: "r",
          journalPath: "j",
          phases: [{ title: "p", status: "in_progress" }],
        },
      },
      t0 + ENDED_MS,
    ),
    false,
  );
});

test("formatEndedSummary 有任務數與最後活動", () => {
  const line = formatEndedSummary({
    ...base,
    tasks: {
      a: { id: "a", status: "completed", subject: "A" },
      b: { id: "b", status: "pending", subject: "B" },
    },
    activity: {
      toolName: "Read",
      phase: "done",
      summary: "正在讀取 x",
      at: base.updatedAt,
    },
  });
  assert.match(line, /似乎已結束/);
  assert.match(line, /任務 1\/2/);
  assert.match(line, /Read/);
});

test("formatEndedSummary 無 task／todo → 任務 —", () => {
  const line = formatEndedSummary(base);
  assert.match(line, /任務 —/);
  assert.match(line, /無活動/);
});

test("formatEndedSummary 排除 deleted task，不計入分母也不計入分子", () => {
  const line = formatEndedSummary({
    ...base,
    tasks: {
      a: { id: "a", status: "completed", subject: "A" },
      b: { id: "b", status: "pending", subject: "B" },
      c: { id: "c", status: "deleted", subject: "C" },
    },
  });
  assert.match(line, /任務 1\/2/);
});

test("formatEndedSummary 全部都是 deleted task → 任務 —（視同沒有任務）", () => {
  const line = formatEndedSummary({
    ...base,
    tasks: { a: { id: "a", status: "deleted", subject: "A" } },
  });
  assert.match(line, /任務 —/);
});

test("formatEndedSummary 沒有 advice 參數時行為不變（不附加建議段落）", () => {
  const line = formatEndedSummary(base);
  assert.doesNotMatch(line, /##/);
});

test("formatEndedSummary advice 為空陣列時不附加建議段落", () => {
  const line = formatEndedSummary(base, []);
  assert.doesNotMatch(line, /##/);
});

test("formatEndedSummary 有 advice 時，在摘要下面附上分組後的建議內容", () => {
  const advice: Advice[] = [
    {
      sessionId: "s1",
      kind: "fat-tool-result",
      at: "2026-09-16T09:00:00.000Z",
      severity: "warn",
      summary: "第一筆",
      action: "act-1",
      target: "src/foo.ts",
    },
    {
      sessionId: "s1",
      kind: "fat-tool-result",
      at: "2026-09-16T09:10:00.000Z",
      severity: "critical",
      summary: "第二筆",
      action: "act-2",
      target: "src/foo.ts",
    },
  ];
  const line = formatEndedSummary(base, advice);
  assert.match(line, /似乎已結束/);
  assert.match(line, /共 2 則：fat-tool-result 2/);
  assert.match(line, /## fat-tool-result · 2 則/);
  assert.match(line, /✗ 第二筆（×2 次）/);
  assert.match(line, /  → act-2/);
});
