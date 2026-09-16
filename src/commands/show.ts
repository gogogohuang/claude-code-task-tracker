import { SESSION_CACHE_NOT_CONTEXT_NOTE } from "../session-cache-scope.js";
import { shortSessionId } from "../session-preference.js";
import {
  filterSessionHints,
  formatSessionListLine,
  loadSessionHints,
  readSessionCacheRaw,
  resolveSessionId,
  serializeSessionCache,
} from "../show-session-cache.js";
import { listSessionIds, readTaskState, statePathForSession } from "../store.js";

export interface RunShowOptions {
  session?: string;
  all?: boolean;
  cwd?: string;
  /** 只印暫存檔路徑 */
  path?: boolean;
  /** 單行 JSON */
  compact?: boolean;
  /** 略過 schema，直接印磁碟上的 raw 內容 */
  raw?: boolean;
}

export function runShow(opts: RunShowOptions = {}): number {
  const cwd = opts.cwd ?? process.cwd();
  const sessionIds = listSessionIds();

  if (opts.session) {
    const resolved = resolveSessionId(opts.session, sessionIds);
    if (!resolved) {
      console.error(`找不到 session：${opts.session}`);
      if (sessionIds.length > 0) {
        console.error(`已知 session：${sessionIds.map(shortSessionId).join(", ")}`);
      }
      return 1;
    }
    const filePath = statePathForSession(resolved);
    if (opts.path) {
      console.log(filePath);
      return 0;
    }
    console.log(`# ${filePath}`);
    if (opts.raw) {
      const raw = readSessionCacheRaw(resolved);
      if (raw === undefined) {
        console.error("暫存檔不存在或無法讀取。");
        return 1;
      }
      console.log(raw.trimEnd());
      return 0;
    }
    const state = readTaskState(resolved);
    if (!state) {
      console.error("暫存檔存在但格式無法解析；可加 --raw 查看原始內容。");
      return 1;
    }
    console.log(serializeSessionCache(state, opts.compact === true));
    return 0;
  }

  const hints = filterSessionHints(loadSessionHints(sessionIds), cwd, opts.all === true);
  if (hints.length === 0) {
    console.log(opts.all ? "沒有任何 session 暫存。" : "目前專案沒有 session 暫存。");
    console.log(SESSION_CACHE_NOT_CONTEXT_NOTE);
    return 0;
  }

  console.log("Session 暫存（task-tracker 狀態檔，不影響 Claude context）：");
  for (const hint of hints) {
    console.log(formatSessionListLine(hint));
    console.log(`  id: ${hint.sessionId}`);
    console.log(`  path: ${statePathForSession(hint.sessionId)}`);
  }
  console.log("");
  console.log("檢視內容：task-tracker show --session <短 id 或完整 id>");
  return 0;
}
