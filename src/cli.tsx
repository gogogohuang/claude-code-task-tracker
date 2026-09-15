import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import { Command } from "commander";
import { runClear } from "./commands/clear.js";
import { runInit } from "./commands/init.js";
import { installTrackerHooks, resolveBundledHookPath } from "./install-hooks.js";
import { defaultManagedPolicyPath } from "./inspect/paths.js";
import { STATE_DIR } from "./store.js";
import { App } from "./ui/App.js";
import { InspectApp } from "./ui/InspectApp.js";

/** dist/cli.js 跟 package.json 固定相鄰一層（src/cli.tsx 開發模式下也是）。 */
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}

const program = new Command();

program.name("task-tracker").description("即時追蹤 Claude Code 自己開出來的 task（TodoWrite）");

program
  .command("init")
  .description("在 ~/.claude/settings.json 註冊 task-tracker hook（所有專案都生效）")
  .option("--project", "改寫入目前專案的 .claude/settings.json")
  .action((opts: { project?: boolean }) => {
    runInit(opts.project ? "project" : "user");
  });

program
  .command("version")
  .description("顯示目前安裝的 task-tracker 版本")
  .action(() => {
    console.log(readPackageVersion());
  });

program
  .command("clear")
  .description("清除 session 暫存狀態檔（預設只清目前專案）")
  .option("--all", "清除全部專案的 session 狀態檔")
  .option("--log", "一併清除 hook-debug.log")
  .action((opts: { all?: boolean; log?: boolean }) => {
    runClear({ all: opts.all, log: opts.log });
  });

program
  .command("inspect")
  .description("檢視這個專案會進 prompt 的 CLAUDE.md、rules、skills 與 auto memory")
  .option("--dir <path>", "要解析的目錄，預設為目前工作目錄")
  .action((opts: { dir?: string }) => {
    const cwd = resolve(opts.dir ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      console.error(`目錄不存在：${cwd}`);
      process.exitCode = 1;
      return;
    }
    render(
      <InspectApp
        options={{
          cwd,
          env: process.env,
          home: homedir(),
          managedPolicyPath: defaultManagedPolicyPath(),
        }}
      />,
    );
  });

program
  .command("watch")
  .description("開啟 TUI，即時觀看 task 進度")
  .option("--session <id>", "指定要觀看的 session id（不指定則自動偵測或列出選單）")
  .action((opts: { session?: string }) => {
    const install = installTrackerHooks({
      scope: "user",
      home: homedir(),
      cwd: process.cwd(),
      execPath: process.execPath,
      bundledHookPath: resolveBundledHookPath(),
      stateDir: STATE_DIR,
    });
    const emptyHint = install.ok
      ? [
          `Hook 已寫入 ${install.settingsPath}。`,
          "請啟動或重開 Claude Code，開始對話後這裡就會出現進度。",
        ]
      : [
          "請確認已執行「task-tracker init」，且 Claude Code 正在執行中。",
          install.error,
        ];
    render(<App initialSessionId={opts.session} emptyHint={emptyHint} watchCwd={process.cwd()} />);
  });

program.parse();
