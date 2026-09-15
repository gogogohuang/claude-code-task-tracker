import { STATE_DIR } from "../store.js";
import { clearSessions } from "../clear-sessions.js";
import { shortSessionId } from "../session-preference.js";

export function runClear(opts: { all?: boolean; log?: boolean; cwd?: string } = {}): void {
  const result = clearSessions({
    stateDir: STATE_DIR,
    cwd: opts.cwd ?? process.cwd(),
    all: opts.all === true,
    clearLog: opts.log === true,
  });

  if (result.deletedSessionIds.length === 0 && !result.logDeleted) {
    console.log(opts.all ? "沒有可清除的 session。" : "目前專案沒有可清除的 session。");
    return;
  }

  if (result.deletedSessionIds.length > 0) {
    const ids = result.deletedSessionIds.map(shortSessionId).join(", ");
    console.log(`已清除 ${result.deletedSessionIds.length} 個 session：${ids}`);
  }
  if (result.logDeleted) {
    console.log("已清除 hook-debug.log。");
  }
}
