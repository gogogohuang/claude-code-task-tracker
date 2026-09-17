import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import { TaskState, TaskStateSchema } from "./schema.js";
import { normalizeOptionalCwd } from "./session-preference.js";

function resolveStateDir(): string {
  const override = process.env.CLAUDE_TASK_TRACKER_DIR?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".claude-task-tracker");
}

/**
 * 刻意只在 module load 時讀一次：每個 hook 事件、CLI 指令、TUI 都是獨立 process，
 * process 生命週期內 CLAUDE_TASK_TRACKER_DIR 不會變，不像 locale.ts 需要因應同一
 * process 內語系切換而每次呼叫重讀。
 */
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

export function writeTaskState(state: TaskState): void {
  ensureStateDir();
  const normalized: TaskState = {
    ...state,
    cwd: normalizeOptionalCwd(state.cwd),
  };
  writeFileAtomic(statePathForSession(normalized.sessionId), JSON.stringify(normalized, null, 2));
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

const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 每個 hook 事件是獨立 subprocess，同一 session_id 的並行呼叫都對同一份狀態檔
 * 做 read-modify-write；用鎖檔把 critical section 序列化，避免其中一個的更新
 * 被另一個蓋掉。逾時或鎖檔卡太久（例如持鎖的 process crash）就強制搶鎖，
 * 因為 hook 必須永遠 exit 0，不能因為搶不到鎖而卡死使用者的 session。
 */
export async function withSessionLock<T>(
  sessionId: string,
  fn: () => T,
  options?: { dir?: string },
): Promise<T> {
  const dir = options?.dir ?? STATE_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, `${sessionId}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // 鎖檔剛好被另一個 process 釋放了，重試搶鎖
      }
      if (Date.now() > deadline) {
        rmSync(lockPath, { force: true });
        continue;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
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
