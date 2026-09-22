import assert from "node:assert/strict";
import test from "node:test";
import type { TaskState } from "./schema.js";
import {
  HEURISTIC_BUSY_MS,
  HOOK_FRESH_THRESHOLD_MS,
  resolvePresence,
} from "./status-detect.js";

const base = (over: Partial<TaskState> = {}): TaskState => ({
  sessionId: "s1",
  updatedAt: "2026-09-22T10:00:00.000Z",
  ...over,
});

const t0 = Date.parse("2026-09-22T10:00:00.000Z");

test("Tier 1 hook：狀態檔夠新鮮時沿用 classifyPresence（busy）", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    activity: { toolName: "Read", phase: "running", at: new Date(t0).toISOString() },
  });
  const result = resolvePresence(state, t0 + 1_000);
  assert.deepEqual(result, { presence: "busy", tier: "hook" });
});

test("Tier 1 hook：新鮮時 waiting 工具仍回 waiting", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    activity: { toolName: "AskUserQuestion", phase: "running", at: new Date(t0).toISOString() },
  });
  assert.deepEqual(resolvePresence(state, t0 + 1_000), { presence: "waiting", tier: "hook" });
});

test("Tier 1 邊界：剛好未滿 HOOK_FRESH 仍走 hook", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    activity: { toolName: "Read", phase: "running", at: new Date(t0).toISOString() },
  });
  assert.equal(resolvePresence(state, t0 + HOOK_FRESH_THRESHOLD_MS - 1).tier, "hook");
});

test("Tier 2 pid：過期但 pid 活著 → idle", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    pid: 4242,
    activity: { toolName: "Read", phase: "running", at: new Date(t0).toISOString() },
  });
  const result = resolvePresence(state, t0 + HOOK_FRESH_THRESHOLD_MS, {
    isPidAlive: (pid) => pid === 4242,
  });
  assert.deepEqual(result, { presence: "idle", tier: "pid" });
});

test("Tier 2 不觸發：過期且 pid 已死 → 落到 heuristic", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    pid: 4242,
    activity: { toolName: "Read", phase: "running", at: new Date(t0).toISOString() },
  });
  const result = resolvePresence(state, t0 + HOOK_FRESH_THRESHOLD_MS, {
    isPidAlive: () => false,
  });
  assert.equal(result.tier, "heuristic");
});

test("Tier 3 heuristic：無 pid、剛過 hook 新鮮期但仍 <30s → busy", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    activity: { toolName: "Read", phase: "done", at: new Date(t0).toISOString() },
  });
  const result = resolvePresence(state, t0 + HOOK_FRESH_THRESHOLD_MS);
  assert.deepEqual(result, { presence: "busy", tier: "heuristic" });
});

test("Tier 3 heuristic：無 pid、過期 ≥30s → idle", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
  });
  const result = resolvePresence(state, t0 + HEURISTIC_BUSY_MS);
  assert.deepEqual(result, { presence: "idle", tier: "heuristic" });
});

test("classifyPresence 本身不被改動：過期但若強行只看 hook 邏輯仍會 busy；resolve 會蓋成 idle", () => {
  // 回歸：長時間 phase=running 不能永遠 busy；有活 pid 時 resolve 改 idle
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    pid: 1,
    activity: { toolName: "Bash", phase: "running", at: new Date(t0).toISOString() },
  });
  assert.deepEqual(
    resolvePresence(state, t0 + HOOK_FRESH_THRESHOLD_MS + 1, { isPidAlive: () => true }),
    { presence: "idle", tier: "pid" },
  );
});

test("逾 HOOK_FRESH 仍在等你：即使 pid 活著也不被 Tier 2 蓋成 idle", () => {
  const state = base({
    updatedAt: new Date(t0).toISOString(),
    pid: 4242,
    activity: {
      toolName: "AskUserQuestion",
      phase: "running",
      at: new Date(t0).toISOString(),
    },
  });
  assert.deepEqual(
    resolvePresence(state, t0 + HOOK_FRESH_THRESHOLD_MS + 60_000, {
      isPidAlive: () => true,
    }),
    { presence: "waiting", tier: "hook" },
  );
});
