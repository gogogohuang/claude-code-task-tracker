import type { ActivityPhase } from "./schema.js";

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

function rawString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  return value.trim().length > 0 ? value : undefined;
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
