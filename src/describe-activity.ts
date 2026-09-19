import type { ActivityPhase } from "./schema.js";
import type { Locale } from "./locale.js";
import { parseWorkflowMeta } from "./workflow/parse-meta.js";

const FRAGMENT_LIMIT = 80;

export function describeActivity(input: {
  toolName: string;
  toolInput: unknown;
  cwd?: string;
  phase: ActivityPhase;
  locale?: Locale;
}): string {
  const locale = input.locale ?? "zh";
  const record = asRecord(input.toolInput);
  if (!record) return fallback(input.toolName, input.phase, locale);
  return (
    sentenceFor(input.toolName, record, input.cwd, input.phase, locale) ??
    fallback(input.toolName, input.phase, locale)
  );
}

function sentenceFor(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  phase: ActivityPhase,
  locale: Locale,
): string | undefined {
  switch (toolName) {
    case "Read":
      return pathSentence(toolInput, cwd, phase, locale, "讀取", "Reading", "Read");
    case "Edit":
    case "NotebookEdit":
      return pathSentence(toolInput, cwd, phase, locale, "修改", "Editing", "Edited");
    case "Write":
      return pathSentence(toolInput, cwd, phase, locale, "寫入", "Writing", "Wrote");
    case "apply_patch":
      return patchSentence(toolInput, cwd, phase, locale);
    case "Glob":
      return spaced(phase, locale, "尋找", "Finding", "Found", pickFragment(toolInput, "pattern"));
    case "Grep":
      return labeled(phase, locale, "搜尋程式碼", "Searching code", "Searched code", pickFragment(toolInput, "pattern"));
    case "WebSearch":
      return labeled(phase, locale, "搜尋網頁", "Searching the web", "Searched the web", pickFragment(toolInput, "query"));
    case "WebFetch":
      return spaced(phase, locale, "抓取", "Fetching", "Fetched", pickFragment(toolInput, "url"));
    case "Bash":
    case "PowerShell":
      return spaced(phase, locale, "執行", "Running", "Ran", shellFragment(toolInput));
    case "Agent":
      return agentSentence(toolInput, phase, locale);
    case "AskUserQuestion":
      return labeled(phase, locale, "詢問", "Asking", "Asked", firstQuestion(toolInput));
    case "ExitPlanMode":
      if (locale === "en") {
        return phase === "running" ? "Waiting for plan approval" : "Submitted plan";
      }
      return phase === "running" ? "正在等待核准計畫" : "已送出計畫";
    case "TodoWrite":
      if (locale === "en") {
        return phase === "running" ? "Updating todo list" : "Updated todo list";
      }
      return phase === "running" ? "正在更新任務清單" : "已更新任務清單";
    case "TaskCreate":
      return taskSentence(
        phase,
        locale,
        "建立任務",
        "Creating task",
        "Created task",
        pickFragment(toolInput, "subject") ?? pickFragment(toolInput, "title"),
      );
    case "TaskUpdate":
      return taskSentence(
        phase,
        locale,
        "更新任務",
        "Updating task",
        "Updated task",
        pickFragment(toolInput, "subject") ?? pickFragment(toolInput, "title"),
      );
    case "TaskList":
      if (locale === "en") {
        return phase === "running" ? "Reading task list" : "Read task list";
      }
      return phase === "running" ? "正在讀取任務清單" : "已讀取任務清單";
    case "Workflow":
      return workflowSentence(toolInput, phase, locale);
    case "Skill":
      return labeled(
        phase,
        locale,
        "使用技能",
        "Using skill",
        "Used skill",
        pickFragment(toolInput, "skill") ?? pickFragment(toolInput, "skillName"),
      );
    default:
      return undefined;
  }
}

function pathSentence(
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  phase: ActivityPhase,
  locale: Locale,
  verbZh: string,
  enRunning: string,
  enDone: string,
): string | undefined {
  const filePath = rawString(toolInput, "file_path")?.trim();
  if (!filePath) return undefined;
  return spaced(phase, locale, verbZh, enRunning, enDone, displayPath(filePath, cwd));
}

function spaced(
  phase: ActivityPhase,
  locale: Locale,
  verbZh: string,
  enRunning: string,
  enDone: string,
  fragment: string | undefined,
): string | undefined {
  if (!fragment) return undefined;
  if (locale === "en") {
    const head = phase === "running" ? enRunning : enDone;
    return `${head} ${fragment}`;
  }
  const head = phase === "running" ? `正在${verbZh}` : `已${verbZh}`;
  return `${head} ${fragment}`;
}

function labeled(
  phase: ActivityPhase,
  locale: Locale,
  labelZh: string,
  enRunning: string,
  enDone: string,
  fragment: string | undefined,
): string | undefined {
  if (!fragment) return undefined;
  if (locale === "en") {
    const head = phase === "running" ? enRunning : enDone;
    return `${head}: ${fragment}`;
  }
  const head = phase === "running" ? `正在${labelZh}` : `已${labelZh}`;
  return `${head}：${fragment}`;
}

function workflowSentence(
  toolInput: Record<string, unknown>,
  phase: ActivityPhase,
  locale: Locale,
): string {
  const fromScript = typeof toolInput.script === "string" ? parseWorkflowMeta(toolInput.script)?.name : undefined;
  const name = pickFragment(toolInput, "name") ?? fromScript;
  if (locale === "en") {
    if (!name) return phase === "running" ? "Running workflow" : "Started workflow";
    return phase === "running" ? `Running workflow ${name}` : `Started workflow ${name}`;
  }
  if (!name) return phase === "running" ? "正在執行 workflow" : "已啟動 workflow";
  return phase === "running" ? `正在執行 workflow ${name}` : `已啟動 workflow ${name}`;
}

function taskSentence(
  phase: ActivityPhase,
  locale: Locale,
  verbZh: string,
  enRunning: string,
  enDone: string,
  subject: string | undefined,
): string {
  if (!subject) {
    if (locale === "en") return phase === "running" ? enRunning : enDone;
    return phase === "running" ? `正在${verbZh}` : `已${verbZh}`;
  }
  return (
    labeled(phase, locale, verbZh, enRunning, enDone, subject) ??
    (locale === "en"
      ? phase === "running"
        ? enRunning
        : enDone
      : phase === "running"
        ? `正在${verbZh}`
        : `已${verbZh}`)
  );
}

function agentSentence(
  toolInput: Record<string, unknown>,
  phase: ActivityPhase,
  locale: Locale,
): string | undefined {
  const type = pickFragment(toolInput, "subagent_type");
  const description = pickFragment(toolInput, "description");
  if (!type || !description) return undefined;
  if (locale === "en") {
    return labeled(phase, locale, "", `Handing to ${type}`, `Handed to ${type}`, description);
  }
  return labeled(phase, locale, `交給 ${type}`, "", "", description);
}

const PATCH_FILE_RE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m;

/** Codex apply_patch：patch 全文在 tool_input.command，只取第一個檔案標頭，不外流 patch 內容。 */
function patchSentence(
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  phase: ActivityPhase,
  locale: Locale,
): string {
  const file = rawString(toolInput, "command")?.match(PATCH_FILE_RE)?.[1]?.trim();
  const named = file ? spaced(phase, locale, "修改", "Editing", "Edited", displayPath(file, cwd)) : undefined;
  if (named) return named;
  if (locale === "en") return phase === "running" ? "Editing files" : "Edited files";
  return phase === "running" ? "正在修改檔案" : "已修改檔案";
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

function fallback(toolName: string, phase: ActivityPhase, locale: Locale): string {
  if (locale === "en") {
    return phase === "running" ? `Using ${toolName}` : `Used ${toolName}`;
  }
  return phase === "running" ? `正在使用 ${toolName}` : `已使用 ${toolName}`;
}
