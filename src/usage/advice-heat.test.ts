import assert from "node:assert/strict";
import test from "node:test";
import { attachHeavyBaselineHeat } from "./advice-heat.js";
import type { Advice } from "./types.js";

test("attachHeavyBaselineHeat：只幫 heavy-baseline 加 detailLines", () => {
  const advice: Advice[] = [
    { sessionId: "s", kind: "fat-tool-result", at: "t", message: "fat" },
    { sessionId: "s", kind: "heavy-baseline", at: "t", message: "heavy" },
  ];
  const next = attachHeavyBaselineHeat(advice, ["A · 1.0 KB", "B · 2.0 KB"]);
  assert.equal(next[0]!.detailLines, undefined);
  assert.deepEqual(next[1]!.detailLines, ["A · 1.0 KB", "B · 2.0 KB"]);
});

test("attachHeavyBaselineHeat：無熱力行則不改", () => {
  const advice: Advice[] = [
    { sessionId: "s", kind: "heavy-baseline", at: "t", message: "heavy" },
  ];
  const next = attachHeavyBaselineHeat(advice, []);
  assert.equal(next[0]!.detailLines, undefined);
  assert.equal(next[0], advice[0]);
});
