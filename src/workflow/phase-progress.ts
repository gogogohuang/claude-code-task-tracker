import type { WorkflowRun } from "../schema.js";

export function phaseProgress(
  run: WorkflowRun | undefined,
): { done: number; total: number } | undefined {
  if (!run || run.phases.length === 0) return undefined;
  const done = run.phases.filter((p) => p.status === "completed").length;
  return { done, total: run.phases.length };
}
