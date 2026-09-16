import assert from "node:assert/strict";
import test from "node:test";
import { phaseProgress } from "./phase-progress.js";

test("無 workflow → undefined", () => {
  assert.equal(phaseProgress(undefined), undefined);
});

test("空 phases → undefined", () => {
  assert.equal(
    phaseProgress({ runId: "r", journalPath: "j", phases: [] }),
    undefined,
  );
});

test("3 phase 2 completed → 2/3", () => {
  assert.deepEqual(
    phaseProgress({
      runId: "r",
      journalPath: "j",
      phases: [
        { title: "a", status: "completed" },
        { title: "b", status: "completed" },
        { title: "c", status: "in_progress" },
      ],
    }),
    { done: 2, total: 3 },
  );
});
