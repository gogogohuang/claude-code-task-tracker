import type { ActivityPhase } from "./schema.js";
import { parseWorkflowMeta } from "./workflow/parse-meta.js";

const FRAGMENT_LIMIT = 80;

export function describeActivity(input: {
  toolName: string;
  toolInput: unknown;
  cwd?: string;
  phase: ActivityPhase;
}): string {
  const record = asRecord(input.toolInput);
  if (!record) return fallback(input.toolName, input.phase);
  return sentenceFor(input.toolName, record, input.cwd, input.phase) ?? fallback(input.toolName, input.phase);
}

function sentenceFor(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  phase: ActivityPhase,
): string | undefined {
  switch (toolName) {
    case "Read":
      return pathSentence(toolInput, cwd, phase, "讀取");
    case "Edit":
    case "NotebookEdit":
      return pathSentence(toolInput, cwd, phase, "修改");
    case "Write":
      return pathSentence(toolInput, cwd, phase, "寫入");
    case "Glob":
      return spaced(phase, "尋找", pickFragment(toolInput, "pattern"));
    case "Grep":
      return labeled(phase, "搜尋程式碼", pickFragment(toolInput, "pattern"));
    case "WebSearch":
      return labeled(phase, "搜尋網頁", pickFragment(toolInput, "query"));
    case "WebFetch":
      return spaced(phase, "抓取", pickFragment(toolInput, "url"));
    case "Bash":
    case "PowerShell":
      return spaced(phase, "執行", shellFragment(toolInput));
    case "Agent":
      return agentSentence(toolInput, phase);
    case "AskUserQuestion":
      return labeled(phase, "詢問", firstQuestion(toolInput));
    case "ExitPlanMode":
      return phase === "running" ? "正在等待核准計畫" : "已送出計畫";
    case "TodoWrite":
      return phase === "running" ? "正在更新任務清單" : "已更新任務清單";
    case "TaskCreate":
      return taskSentence(phase, "建立任務", pickFragment(toolInput, "subject") ?? pickFragment(toolInput, "title"));
    case "TaskUpdate":
      return taskSentence(phase, "更新任務", pickFragment(toolInput, "subject") ?? pickFragment(toolInput, "title"));
    case "TaskList":
      return phase === "running" ? "正在讀取任務清單" : "已讀取任務清單";
    case "Workflow":
      return workflowSentence(toolInput, phase);
    default:
      return undefined;
  }
}

function pathSentence(
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  phase: ActivityPhase,
  verb: string,
): string | undefined {
  const filePath = rawString(toolInput, "file_path")?.trim();
  if (!filePath) return undefined;
  return spaced(phase, verb, displayPath(filePath, cwd));
}

function spaced(phase: ActivityPhase, verb: string, fragment: string | undefined): string | undefined {
  if (!fragment) return undefined;
  const head = phase === "running" ? `正在${verb}` : `已${verb}`;
  return `${head} ${fragment}`;
}

function labeled(phase: ActivityPhase, label: string, fragment: string | undefined): string | undefined {
  if (!fragment) return undefined;
  const head = phase === "running" ? `正在${label}` : `已${label}`;
  return `${head}：${fragment}`;
}

function workflowSentence(toolInput: Record<string, unknown>, phase: ActivityPhase): string {
  const fromScript = typeof toolInput.script === "string" ? parseWorkflowMeta(toolInput.script)?.name : undefined;
  const name = pickFragment(toolInput, "name") ?? fromScript;
  if (!name) return phase === "running" ? "正在執行 workflow" : "已啟動 workflow";
  return phase === "running" ? `正在執行 workflow ${name}` : `已啟動 workflow ${name}`;
}

function taskSentence(phase: ActivityPhase, verb: string, subject: string | undefined): string {
  if (!subject) return phase === "running" ? `正在${verb}` : `已${verb}`;
  return labeled(phase, verb, subject) ?? (phase === "running" ? `正在${verb}` : `已${verb}`);
}

function agentSentence(toolInput: Record<string, unknown>, phase: ActivityPhase): string | undefined {
  const type = pickFragment(toolInput, "subagent_type");
  const description = pickFragment(toolInput, "description");
  if (!type || !description) return undefined;
  return labeled(phase, `交給 ${type}`, description);
}

function shellFragment(toolInput: Record<string, unknown>): string | undefined {
  const description = pickFragment(toolInput, "description");
  if (description) return description;
  const command = toolInput.command;
  if (typeof command !== "string") return undefined;
  const firstLine = command.split(/\r?\n/, 1)[0] ?? "";
  return nonemptyClip(firstLine);
}

function firstQuestion(toolInput: Record<string, unknown>): string | undefined {
  const questions = toolInput.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const first = asRecord(questions[0]);
  if (!first) return undefined;
  return pickFragment(first, "question");
}

function displayPath(filePath: string, cwd?: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const base = basename(normalized);
  if (!cwd) return clip(base);
  const root = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized === root) return clip(base);
  const prefix = `${root}/`;
  if (normalized.startsWith(prefix)) {
    const relative = normalized.slice(prefix.length);
    return clip(relative.length > 0 ? relative : base);
  }
  return clip(base);
}

function basename(normalized: string): string {
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return parts.at(-1) ?? normalized;
}

function pickFragment(record: Record<string, unknown>, key: string): string | undefined {
  const value = rawString(record, key);
  if (!value) return undefined;
  return nonemptyClip(value);
}

function rawString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  return value.trim().length > 0 ? value : undefined;
}

function nonemptyClip(value: string): string | undefined {
  const clipped = clip(value);
  return clipped.length > 0 ? clipped : undefined;
}

function clip(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= FRAGMENT_LIMIT) return line;
  return `${line.slice(0, FRAGMENT_LIMIT - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function fallback(toolName: string, phase: ActivityPhase): string {
  return phase === "running" ? `正在使用 ${toolName}` : `已使用 ${toolName}`;
}
