import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkflowMeta } from "./parse-meta.js";

const SCRIPT = `
export const meta = {
  name: 'linego-feature-workflow',
  description: 'One workflow for the whole pipeline',
  phases: [
    { title: 'Fetch Ticket + Write Plan', detail: 'fetch then draft' },
    { title: 'Self-Grill', detail: 'unattended only' },
    { title: 'Execute Plan', detail: 'assess then run' },
    { title: 'Gate', detail: 'pr gate' },
    { title: 'Push & Open PR', detail: 'gh pr create' },
  ],
}
`;

test("parseWorkflowMeta 抽出 name 與 phases 標題，忽略 detail", () => {
  const meta = parseWorkflowMeta(SCRIPT);
  assert.deepEqual(meta, {
    name: "linego-feature-workflow",
    phases: ["Fetch Ticket + Write Plan", "Self-Grill", "Execute Plan", "Gate", "Push & Open PR"],
  });
});

test("parseWorkflowMeta 沒有 meta 或 phases 就回 undefined", () => {
  assert.equal(parseWorkflowMeta("const x = 1"), undefined);
  assert.equal(parseWorkflowMeta("export const meta = { name: 'x' }"), undefined);
});
