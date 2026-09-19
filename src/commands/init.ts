import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Agent } from "../agent.js";
import { codexConfigPath, codexHooksDisabled } from "../codex-config.js";
import { STATE_DIR } from "../store.js";
import { HookScope, installTrackerHooks, resolveBundledHookPath } from "../install-hooks.js";

function codexNotes(home: string): string[] {
  const notes: string[] = [];
  const configPath = codexConfigPath(home);
  try {
    if (existsSync(configPath) && codexHooksDisabled(readFileSync(configPath, "utf-8"))) {
      notes.push(`注意：${configPath} 的 [features] 把 hooks 關掉了，請改成 hooks = true，否則 hook 不會執行。`);
    }
  } catch {
    // 讀不到就只是少一則提醒，不擋安裝
  }
  notes.push(
    "Codex 會要求核可新的 hook：請開啟 Codex，在啟動時的 hooks review 核可 task-tracker 的 hook。",
    "尚未核可前 hook 不會執行；`codex exec` 沒有核可畫面，需先在互動模式核可一次。",
    "已用 Codex 0.155.1 測試；目前只支援活動句，任務清單、用量、inspect 尚未支援 Codex。",
  );
  return notes;
}

export function runInit(scope: HookScope = "user", agent: Agent = "claude"): void {
  const home = homedir();
  const result = installTrackerHooks({
    scope, home, cwd: process.cwd(), execPath: process.execPath,
    bundledHookPath: resolveBundledHookPath(), stateDir: STATE_DIR, agent,
  });

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  if (result.already) {
    console.log("Hook 已經註冊過了，不需要重複設定。");
    if (agent === "codex") for (const note of codexNotes(home)) console.log(note);
    return;
  }

  console.log(`已將 task-tracker hook 寫入 ${result.settingsPath}`);
  console.log("Hook 腳本放在 ~/.claude-task-tracker/，不會綁死 npx 快取路徑。");
  if (scope === "user") {
    console.log(agent === "codex"
      ? "這是使用者層設定，之後任何專案的 Codex session 都會同步。"
      : "這是使用者層設定，之後任何專案的 Claude Code session 都會同步。");
  } else {
    console.log(agent === "codex"
      ? "之後在這個專案跑 Codex 時，目前活動會自動同步。"
      : "之後在這個專案跑 Claude Code 時，task 更新跟目前活動都會自動同步。");
  }
  console.log("執行 `task-tracker watch` 開始觀看即時進度。");
  console.log("");
  if (agent === "codex") {
    for (const note of codexNotes(home)) console.log(note);
    return;
  }
  console.log(
    "提醒：Sonnet 5 / Opus 4.8 等新版模型預設不帶 TodoWrite 工具，若要讓它產生 task，\n" +
      "請在啟動 Claude Code 前設定環境變數 CLAUDE_CODE_ENABLE_TODO_TOOLS=1。",
  );
}
