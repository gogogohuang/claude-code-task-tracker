import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TaskState, TaskStateSchema } from "./schema.js";
import { normalizeOptionalCwd } from "./session-preference.js";

function resolveStateDir(): string {
  const override = process.env.CLAUDE_TASK_TRACKER_DIR?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".claude-task-tracker");
}

export const STATE_DIR = resolveStateDir();
export const DEBUG_LOG_PATH = join(STATE_DIR, "hook-debug.log");

export function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function statePathForSession(sessionId: string): string {
  return join(STATE_DIR, `${sessionId}.json`);
}

/** 用 write-then-rename 避免 TUI 讀到寫一半的檔案。 */
export function writeTaskState(state: TaskState): void {
  ensureStateDir();
  const normalized: TaskState = {
    ...state,
    cwd: normalizeOptionalCwd(state.cwd),
  };
  const finalPath = statePathForSession(normalized.sessionId);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), "utf-8");
  renameSync(tmpPath, finalPath);
}

export function readTaskState(sessionId: string): TaskState | null {
  const path = statePathForSession(sessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const parsed = TaskStateSchema.parse(raw);
    return { ...parsed, cwd: normalizeOptionalCwd(parsed.cwd) };
  } catch {
    return null;
  }
}

export function listSessionIds(): string[] {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function appendDebugLog(message: string): void {
  ensureStateDir();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    writeFileSync(DEBUG_LOG_PATH, line, { flag: "a" });
  } catch {
    // debug log 寫入失敗不該影響主流程
  }
}
