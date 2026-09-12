import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { App } from "./ui/App.js";

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
  .description("在目前專案的 .claude/settings.json 註冊 task-tracker hook")
  .action(() => {
    runInit();
  });

program
  .command("version")
  .description("顯示目前安裝的 task-tracker 版本")
  .action(() => {
    console.log(readPackageVersion());
  });

program
  .command("watch")
  .description("開啟 TUI，即時觀看 task 進度")
  .option("--session <id>", "指定要觀看的 session id（不指定則自動偵測或列出選單）")
  .action((opts: { session?: string }) => {
    render(<App initialSessionId={opts.session} />);
  });

program.parse();
