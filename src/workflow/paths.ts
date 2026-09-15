import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { WorkflowRun } from "../schema.js";
import { applyJournalToPhases, parseJournalEvents } from "./journal.js";
import { parseWorkflowMeta } from "./parse-meta.js";

const RUN_ID = /wf_[a-z0-9-]{6,}/i;

export function sessionDirFromTranscript(transcriptPath: string): string {
  return dirname(transcriptPath);
}

export function journalPathFor(transcriptPath: string, runId: string): string {
  return join(sessionDirFromTranscript(transcriptPath), "subagents", "workflows", runId, "journal.jsonl");
}

export function extractRunId(toolInput: unknown, toolResponse: unknown): string | undefined {
  const input = asRecord(toolInput);
  if (typeof input?.resumeFromRunId === "string") return input.resumeFromRunId;
  const fromResponse = runIdFrom(toolResponse);
  if (fromResponse) return fromResponse;
  const scriptPath = typeof input?.scriptPath === "string" ? input.scriptPath : "";
  return scriptPath.match(RUN_ID)?.[0];
}

export function hydrateWorkflowRun(run: WorkflowRun): WorkflowRun {
  if (!existsSync(run.journalPath)) return run;
  try {
    const events = parseJournalEvents(readFileSync(run.journalPath, "utf-8"));
    return { ...run, phases: applyJournalToPhases(run.phases.map((phase) => phase.title), events) };
  } catch {
    return run;
  }
}

export function discoverWorkflowRun(sessionDir: string): WorkflowRun | undefined {
  const workflowsDir = join(sessionDir, "subagents", "workflows");
  if (!existsSync(workflowsDir)) return undefined;
  let latest: { runId: string; journalPath: string; mtime: number } | undefined;
  for (const name of readdirSync(workflowsDir)) {
    const journalPath = join(workflowsDir, name, "journal.jsonl");
    if (!existsSync(journalPath)) continue;
    const mtime = statSync(journalPath).mtimeMs;
    if (!latest || mtime > latest.mtime) latest = { runId: name, journalPath, mtime };
  }
  if (!latest) return undefined;

  const scriptsDir = join(sessionDir, "workflows", "scripts");
  let source: string | undefined;
  if (existsSync(scriptsDir)) {
    for (const file of readdirSync(scriptsDir)) {
      if (file.includes(latest.runId) && file.endsWith(".js")) {
        source = readFileSync(join(scriptsDir, file), "utf-8");
        break;
      }
    }
  }
  const meta = source ? parseWorkflowMeta(source) : undefined;
  if (!meta) return undefined;
  return hydrateWorkflowRun({
    runId: latest.runId,
    name: meta.name,
    journalPath: latest.journalPath,
    phases: meta.phases.map((title) => ({ title, status: "pending" })),
  });
}

export function liveWorkflow(state: {
  workflow?: WorkflowRun;
  claudeSessionDir?: string;
}): WorkflowRun | undefined {
  const seeded = state.workflow ? hydrateWorkflowRun(state.workflow) : undefined;
  if (seeded) return seeded;
  if (!state.claudeSessionDir) return undefined;
  return discoverWorkflowRun(state.claudeSessionDir);
}

function runIdFrom(value: unknown): string | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  if (typeof obj.runId === "string") return obj.runId;
  return runIdFrom(obj.data);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
