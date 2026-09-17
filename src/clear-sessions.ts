import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sameCwd } from "./session-preference.js";

export interface ClearSessionsInput {
  stateDir: string;
  cwd: string;
  all?: boolean;
  clearLog?: boolean;
}

export interface ClearSessionsResult {
  deletedSessionIds: string[];
  logDeleted: boolean;
}

function readSessionCwd(path: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { cwd?: unknown };
    return typeof raw.cwd === "string" ? raw.cwd : undefined;
  } catch {
    return undefined;
  }
}

export function clearSessions(input: ClearSessionsInput): ClearSessionsResult {
  const deletedSessionIds: string[] = [];
  if (!existsSync(input.stateDir)) {
    return { deletedSessionIds, logDeleted: false };
  }

  for (const name of readdirSync(input.stateDir)) {
    if (/\.json\.tmp-\d+$/.test(name)) {
      // crash 在 write-then-rename 寫一半留下的孤兒暫存檔，跟 cwd 篩選無關，直接清掉。
      try {
        unlinkSync(join(input.stateDir, name));
      } catch {
        // 刪不掉就略過，不中斷其他檔
      }
      continue;
    }
    if (!name.endsWith(".json")) continue;
    const sessionId = name.slice(0, -".json".length);
    const path = join(input.stateDir, name);
    if (!input.all) {
      const sessionCwd = readSessionCwd(path);
      if (!sameCwd(sessionCwd, input.cwd)) continue;
    }
    try {
      unlinkSync(path);
      deletedSessionIds.push(sessionId);
    } catch {
      // 刪不掉就略過，不中斷其他檔
    }
  }

  let logDeleted = false;
  if (input.clearLog) {
    const logPath = join(input.stateDir, "hook-debug.log");
    if (existsSync(logPath)) {
      try {
        unlinkSync(logPath);
        logDeleted = true;
      } catch {
        // 同上
      }
    }
  }

  return { deletedSessionIds, logDeleted };
}
