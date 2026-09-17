import assert from "node:assert/strict";
import test from "node:test";
import { subagentBlockRows } from "./subagents-block.js";
import type { SubagentsState } from "../usage/subagents.js";

test("subagentBlockRows：沒有 subagents 或沒有 dispatch 回 0", () => {
  assert.equal(subagentBlockRows(undefined), 0);
  assert.equal(subagentBlockRows({ dispatches: [] }), 0);
});

test("subagentBlockRows：標題行 + 每個 dispatch 一行 + Box 自己的 marginBottom 一行", () => {
  const subagents: SubagentsState = {
    dispatches: [
      { toolUseId: "a", status: "running" },
      { toolUseId: "b", status: "done" },
    ],
  };
  assert.equal(subagentBlockRows(subagents), 4);
});

test("subagentBlockRows：有 latestSidechainActivity 再加一行", () => {
  const subagents: SubagentsState = {
    dispatches: [{ toolUseId: "a", status: "running" }],
    latestSidechainActivity: { text: "Read x" },
  };
  assert.equal(subagentBlockRows(subagents), 4);
});
