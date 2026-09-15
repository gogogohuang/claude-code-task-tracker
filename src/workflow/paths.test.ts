import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverWorkflowRun, extractRunId, journalPathFor, sessionDirFromTranscript } from "./paths.js";

test("sessionDirFromTranscript 與 journalPathFor 依 Claude Code 目錄慣例組路徑", () => {
  const transcript = "/Users/me/.claude/projects/proj/abc.jsonl";
  assert.equal(sessionDirFromTranscript(transcript), "/Users/me/.claude/projects/proj");
  assert.equal(
    journalPathFor(transcript, "wf_27dc174c-59f"),
    "/Users/me/.claude/projects/proj/subagents/workflows/wf_27dc174c-59f/journal.jsonl",
  );
});

test("extractRunId 依 resumeFromRunId、tool_response、scriptPath 檔名取 runId", () => {
  assert.equal(extractRunId({ resumeFromRunId: "wf_abc123" }, undefined), "wf_abc123");
  assert.equal(extractRunId({}, { runId: "wf_from_top" }), "wf_from_top");
  assert.equal(extractRunId({}, { data: { runId: "wf_nested" } }), "wf_nested");
  assert.equal(
    extractRunId({ scriptPath: "/tmp/linego-feature-workflow-wf_27dc174c-59f.js" }, undefined),
    "wf_27dc174c-59f",
  );
  assert.equal(extractRunId({}, {}), undefined);
});

test("discoverWorkflowRun 讀最新 journal 旁邊的 script meta", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-discover-"));
  const runId = "wf_27dc174c-59f";
  mkdirSync(join(root, "subagents", "workflows", runId), { recursive: true });
  mkdirSync(join(root, "workflows", "scripts"), { recursive: true });
  writeFileSync(join(root, "subagents", "workflows", runId, "journal.jsonl"), '{"type":"launched"}\n');
  writeFileSync(
    join(root, "workflows", "scripts", `linego-feature-workflow-${runId}.js`),
    "export const meta = { name: 'linego-feature-workflow', phases: [{ title: 'Gate' }] }\n",
  );
  const run = discoverWorkflowRun(root);
  assert.equal(run?.runId, runId);
  assert.equal(run?.name, "linego-feature-workflow");
  assert.deepEqual(
    run?.phases.map((phase) => phase.title),
    ["Gate"],
  );
  assert.equal(run?.journalPath, join(root, "subagents", "workflows", runId, "journal.jsonl"));
});
