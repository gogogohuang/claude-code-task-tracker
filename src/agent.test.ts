import assert from "node:assert/strict";
import test from "node:test";
import { agentOf, parseAgentArg, TAB_AGENTS } from "./agent.js";
import { TaskStateSchema } from "./schema.js";

test("agentOf 缺省視為 claude", () => {
  assert.equal(agentOf(undefined), "claude");
  assert.equal(agentOf(null), "claude");
  assert.equal(agentOf({}), "claude");
  assert.equal(agentOf({ agent: "codex" }), "codex");
});

test("parseAgentArg 只認 --agent codex，其餘一律 claude", () => {
  assert.equal(parseAgentArg(["node", "hook.js"]), "claude");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent", "codex"]), "codex");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent", "claude"]), "claude");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent", "bogus"]), "claude");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent"]), "claude");
});

test("分頁順序固定為 claude、codex、cursor", () => {
  assert.deepEqual([...TAB_AGENTS], ["claude", "codex", "cursor"]);
});

test("TaskStateSchema 接受沒有 agent 的舊狀態檔與 agent=codex", () => {
  const base = { sessionId: "s1", updatedAt: "2026-09-19T00:00:00.000Z" };
  assert.equal(TaskStateSchema.safeParse(base).success, true);
  const codex = TaskStateSchema.safeParse({ ...base, agent: "codex" });
  assert.equal(codex.success, true);
  assert.equal(TaskStateSchema.safeParse({ ...base, agent: "bogus" }).success, false);
});
