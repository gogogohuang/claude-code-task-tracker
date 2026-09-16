import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  discoverWorkflowRun,
  extractRunId,
  hydrateWorkflowRun,
  journalPathFor,
  liveWorkflow,
  resolveTranscriptPath,
  sessionDirFromTranscript,
} from "./paths.js";

test("sessionDirFromTranscript 與 journalPathFor 指到 transcript 同名的 session 工作目錄", () => {
  const transcript = "/Users/me/.claude/projects/proj/abc.jsonl";
  assert.equal(sessionDirFromTranscript(transcript), "/Users/me/.claude/projects/proj/abc");
  assert.equal(
    journalPathFor(transcript, "wf_27dc174c-59f"),
    "/Users/me/.claude/projects/proj/abc/subagents/workflows/wf_27dc174c-59f/journal.jsonl",
  );
});

test("resolveTranscriptPath 優先讀 Claude Code 寫在 project 下的 flat jsonl", () => {
  const project = mkdtempSync(join(tmpdir(), "claude-proj-"));
  const sessionId = "abc-session-id";
  const flat = join(project, `${sessionId}.jsonl`);
  writeFileSync(flat, "{}\n");
  const sessionDir = join(project, sessionId);
  assert.equal(resolveTranscriptPath(sessionDir, sessionId), flat);
});

test("resolveTranscriptPath 相容舊 state：claudeSessionDir 是 project 根目錄", () => {
  const project = mkdtempSync(join(tmpdir(), "claude-proj-legacy-"));
  const sessionId = "legacy-session";
  const flat = join(project, `${sessionId}.jsonl`);
  writeFileSync(flat, "{}\n");
  assert.equal(resolveTranscriptPath(project, sessionId), flat);
});

test("resolveTranscriptPath 檔案還不存在時回 flat 路徑（新 session 預設位置）", () => {
  const project = mkdtempSync(join(tmpdir(), "claude-proj-new-"));
  const sessionId = "new-session";
  const sessionDir = join(project, sessionId);
  const expected = join(project, `${sessionId}.jsonl`);
  assert.equal(existsSync(expected), false);
  assert.equal(resolveTranscriptPath(sessionDir, sessionId), expected);
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

test("liveWorkflow 在舊的錯誤 journalPath 時，改從 project/sessionId 找 journal 並更新進度", () => {
  const project = mkdtempSync(join(tmpdir(), "wf-live-"));
  const sessionId = "sess-1";
  const runId = "wf_abc123";
  const nestedJournal = join(project, sessionId, "subagents", "workflows", runId, "journal.jsonl");
  mkdirSync(join(project, sessionId, "subagents", "workflows", runId), { recursive: true });
  writeFileSync(
    nestedJournal,
    [
      '{"type":"started","key":"a","phase":"Fetch Ticket + Write Plan"}',
      '{"type":"result","key":"a"}',
      '{"type":"started","key":"b","phase":"Self-Grill"}',
    ].join("\n") + "\n",
  );
  const wrongPath = join(project, "subagents", "workflows", runId, "journal.jsonl");
  const live = liveWorkflow({
    sessionId,
    claudeSessionDir: project,
    workflow: {
      runId,
      journalPath: wrongPath,
      phases: [
        { title: "Fetch Ticket + Write Plan", status: "pending" },
        { title: "Self-Grill", status: "pending" },
        { title: "Execute Plan", status: "pending" },
      ],
    },
  });
  assert.equal(live?.journalPath, nestedJournal);
  assert.deepEqual(
    live?.phases.map((phase) => `${phase.title}:${phase.status}`),
    ["Fetch Ticket + Write Plan:completed", "Self-Grill:in_progress", "Execute Plan:pending"],
  );
});

test("hydrateWorkflowRun 找不到 journal 時維持原 phases", () => {
  const run = hydrateWorkflowRun({
    runId: "wf_x",
    journalPath: "/tmp/does-not-exist-journal.jsonl",
    phases: [{ title: "Gate", status: "pending" }],
  });
  assert.deepEqual(run.phases, [{ title: "Gate", status: "pending" }]);
});
