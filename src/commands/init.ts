import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_MATCHER = "TodoWrite";

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
  settings.hooks.PostToolUse ??= [];

  // 用 process.execPath 而不是寫死 "node"，避免使用者用 nvm / 多版本 node 時找不到執行檔。
  const hookCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(resolveHookScriptPath())}`;

  const alreadyRegistered = settings.hooks.PostToolUse.some(
    (group) =>
      group.matcher === HOOK_MATCHER &&
      group.hooks.some((h) => h.command === hookCommand),
  );

  if (alreadyRegistered) {
    console.log("Hook 已經註冊過了，不需要重複設定。");
    return;
  }

  settings.hooks.PostToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: "command", command: hookCommand }],
  });

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  console.log(`已將 task-tracker hook 寫入 ${settingsPath}`);
  console.log("之後在這個專案跑 Claude Code 時，task 更新會自動同步。");
  console.log("執行 `task-tracker watch` 開始觀看即時進度。");
  console.log("");
  console.log(
    "提醒：Sonnet 5 / Opus 4.8 等新版模型預設不帶 TodoWrite 工具，若要讓它產生 task，\n" +
      "請在啟動 Claude Code 前設定環境變數 CLAUDE_CODE_ENABLE_TODO_TOOLS=1。",
  );
}
