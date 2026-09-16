import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { WorkflowRun } from "../schema.js";
import { applyJournalToPhases, parseJournalEvents } from "./journal.js";
import { parseWorkflowMeta } from "./parse-meta.js";

const RUN_ID = /wf_[a-z0-9-]{6,}/i;

/** Claude Code 把 workflow journal 放在 transcript 同名目錄下：`{project}/{sessionId}/subagents/workflows/...` */
export function sessionDirFromTranscript(transcriptPath: string): string {
  const projectDir = dirname(transcriptPath);
  const sessionId = basename(transcriptPath).replace(/\.jsonl$/i, "");
  return join(projectDir, sessionId);
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

/** 舊 state 可能把 journal 指到 project/subagents（少了 sessionId）；依候補路徑找真實檔案。 */
export function resolveWorkflowJournalPath(
  run: Pick<WorkflowRun, "runId" | "journalPath">,
  opts: { claudeSessionDir?: string; sessionId?: string } = {},
): string {
  if (existsSync(run.journalPath)) return run.journalPath;
  const candidates: string[] = [];
  if (opts.claudeSessionDir && opts.sessionId) {
    candidates.push(
      join(opts.claudeSessionDir, opts.sessionId, "subagents", "workflows", run.runId, "journal.jsonl"),
    );
  }
  if (opts.claudeSessionDir) {
    candidates.push(join(opts.claudeSessionDir, "subagents", "workflows", run.runId, "journal.jsonl"));
  }
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return run.journalPath;
}

export function hydrateWorkflowRun(
  run: WorkflowRun,
  opts: { claudeSessionDir?: string; sessionId?: string } = {},
): WorkflowRun {
  const journalPath = resolveWorkflowJournalPath(run, opts);
  if (!existsSync(journalPath)) return { ...run, journalPath };
  try {
    const events = parseJournalEvents(readFileSync(journalPath, "utf-8"));
    return {
      ...run,
      journalPath,
      phases: applyJournalToPhases(
        run.phases.map((phase) => phase.title),
        events,
      ),
    };
  } catch {
    return { ...run, journalPath };
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
  sessionId?: string;
  workflow?: WorkflowRun;
  claudeSessionDir?: string;
}): WorkflowRun | undefined {
  const opts = { claudeSessionDir: state.claudeSessionDir, sessionId: state.sessionId };
  const seeded = state.workflow ? hydrateWorkflowRun(state.workflow, opts) : undefined;
  if (seeded && existsSync(seeded.journalPath)) return seeded;
  // claudeSessionDir 可能是舊的 project root，或新的 session 工作目錄
  if (state.claudeSessionDir && state.sessionId) {
    const nested = join(state.claudeSessionDir, state.sessionId);
    const fromNested = discoverWorkflowRun(nested);
    if (fromNested) return fromNested;
  }
  if (state.claudeSessionDir) {
    const fromDir = discoverWorkflowRun(state.claudeSessionDir);
    if (fromDir) return fromDir;
  }
  return seeded;
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
