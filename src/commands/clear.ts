import { STATE_DIR } from "../store.js";
import { clearSessions } from "../clear-sessions.js";
import { shortSessionId } from "../session-preference.js";
import { SESSION_CACHE_SCOPE_NOTE } from "../session-cache-scope.js";

export function runClear(opts: { all?: boolean; log?: boolean; cwd?: string } = {}): void {
  const result = clearSessions({
    stateDir: STATE_DIR,
    cwd: opts.cwd ?? process.cwd(),
    all: opts.all === true,
    clearLog: opts.log === true,
  });

  if (result.deletedSessionIds.length === 0 && !result.logDeleted) {
    console.log(opts.all ? "沒有可清除的 session 暫存。" : "目前專案沒有可清除的 session 暫存。");
    return;
  }

  if (result.deletedSessionIds.length > 0) {
    const ids = result.deletedSessionIds.map(shortSessionId).join(", ");
    console.log(`已清除 ${result.deletedSessionIds.length} 個 session 暫存：${ids}`);
  }
  if (result.logDeleted) {
    console.log("已清除 hook-debug.log。");
  }
  console.log(SESSION_CACHE_SCOPE_NOTE);
}
