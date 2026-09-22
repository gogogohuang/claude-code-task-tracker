import assert from "node:assert/strict";
import test from "node:test";
import { attachHeavyBaselineHeat } from "./advice-heat.js";
import type { Advice } from "./types.js";

test("attachHeavyBaselineHeat：只幫 heavy-baseline 加 detailLines", () => {
  const advice: Advice[] = [
    { sessionId: "s", kind: "fat-tool-result", at: "t", severity: "warn", summary: "fat", action: "act" },
    { sessionId: "s", kind: "heavy-baseline", at: "t", severity: "warn", summary: "heavy", action: "act" },
  ];
  const next = attachHeavyBaselineHeat(advice, ["A · 1.0 KB", "B · 2.0 KB"]);
  assert.equal(next[0]!.detailLines, undefined);
  assert.deepEqual(next[1]!.detailLines, ["A · 1.0 KB", "B · 2.0 KB"]);
});

test("attachHeavyBaselineHeat：無熱力行仍給 fallback detailLines", () => {
  const advice: Advice[] = [
    { sessionId: "s", kind: "heavy-baseline", at: "t", severity: "warn", summary: "heavy", action: "act" },
  ];
  const next = attachHeavyBaselineHeat(advice, []);
  assert.ok(next[0]!.detailLines?.length);
  assert.match(next[0]!.detailLines![0]!, /inspect/);
});
