import { homedir } from "node:os";
import { STATE_DIR } from "../store.js";
import { HookScope, installTrackerHooks, resolveBundledHookPath } from "../install-hooks.js";

export function runInit(scope: HookScope = "user"): void {
  const result = installTrackerHooks({
    scope,
    home: homedir(),
    cwd: process.cwd(),
    execPath: process.execPath,
    bundledHookPath: resolveBundledHookPath(),
    stateDir: STATE_DIR,
  });

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  if (result.already) {
    console.log("Hook 已經註冊過了，不需要重複設定。");
    return;
  }

  console.log(`已將 task-tracker hook 寫入 ${result.settingsPath}`);
  console.log("Hook 腳本放在 ~/.claude-task-tracker/，不會綁死 npx 快取路徑。");
  if (scope === "user") {
    console.log("這是使用者層設定，之後任何專案的 Claude Code session 都會同步。");
  } else {
    console.log("之後在這個專案跑 Claude Code 時，task 更新跟目前活動都會自動同步。");
  }
  console.log("執行 `task-tracker watch` 開始觀看即時進度。");
  console.log("");
  console.log(
    "提醒：Sonnet 5 / Opus 4.8 等新版模型預設不帶 TodoWrite 工具，若要讓它產生 task，\n" +
      "請在啟動 Claude Code 前設定環境變數 CLAUDE_CODE_ENABLE_TODO_TOOLS=1。",
  );
}
