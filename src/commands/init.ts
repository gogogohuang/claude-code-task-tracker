import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * matcher 用 "*" 涵蓋所有工具，不只 TodoWrite/Task 系列——這樣沒開
 * todo/task 清單時，hook script 仍然能靠 activity 欄位記錄「目前在做
 * 什麼」。PreToolUse 標記開始執行，PostToolUse 標記完成（同時也是舊版
 * TodoWrite/Task 專屬邏輯跑的地方）。
 */
const HOOK_MATCHER = "*";

interface ClaudeHookEntry {
  type: string;
  command: string;
}
interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}
interface ClaudeSettings {
  hooks?: {
    PreToolUse?: ClaudeHookGroup[];
    PostToolUse?: ClaudeHookGroup[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** dist/cli.js 跟 dist/hook/task-tracker-hook.js 是同一次 build 的產物，路徑固定相鄰。 */
function resolveHookScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "hook", "task-tracker-hook.js");
}

export function runInit(): void {
  const settingsDir = join(process.cwd(), ".claude");
  const settingsPath = join(settingsDir, "settings.json");

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }

  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      console.error(`無法解析既有的 ${settingsPath}，請手動檢查後再執行 init。`);
      process.exitCode = 1;
      return;
    }
  }

  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  settings.hooks.PostToolUse ??= [];

  // 用 process.execPath 而不是寫死 "node"，避免使用者用 nvm / 多版本 node 時找不到執行檔。
  const hookCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(resolveHookScriptPath())}`;

  const isRegistered = (groups: ClaudeHookGroup[]) =>
    groups.some((group) => group.matcher === HOOK_MATCHER && group.hooks.some((h) => h.command === hookCommand));

  if (isRegistered(settings.hooks.PreToolUse) && isRegistered(settings.hooks.PostToolUse)) {
    console.log("Hook 已經註冊過了，不需要重複設定。");
    return;
  }

  // 舊版 init（v0.1.0 只認 TodoWrite；v0.2.0/v0.3.0 只認
  // TodoWrite|TaskCreate|TaskUpdate|TaskList）寫入的 matcher 都比現在窄，
  // 這裡先移除同一個 hook command 的舊條目，換成新的 "*" matcher，避免
  // 同一次事件被觸發兩次。
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
    (group) => !group.hooks.some((h) => h.command === hookCommand),
  );
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (group) => !group.hooks.some((h) => h.command === hookCommand),
  );

  settings.hooks.PreToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: "command", command: hookCommand }],
  });
  settings.hooks.PostToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: "command", command: hookCommand }],
  });

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  console.log(`已將 task-tracker hook 寫入 ${settingsPath}`);
  console.log("之後在這個專案跑 Claude Code 時，task 更新跟目前活動都會自動同步。");
  console.log("執行 `task-tracker watch` 開始觀看即時進度。");
  console.log("");
  console.log(
    "提醒：Sonnet 5 / Opus 4.8 等新版模型預設不帶 TodoWrite 工具，若要讓它產生 task，\n" +
      "請在啟動 Claude Code 前設定環境變數 CLAUDE_CODE_ENABLE_TODO_TOOLS=1。",
  );
}
