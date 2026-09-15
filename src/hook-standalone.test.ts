import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundledHook = join(repoRoot, "dist", "hook", "task-tracker-hook.js");

test("複製到空目錄的 hook 不依賴套件 node_modules 也能寫 session", () => {
  assert.equal(existsSync(bundledHook), true, "請先執行 pnpm run build");
  const dir = mkdtempSync(join(tmpdir(), "tracker-hook-"));
  const hookPath = join(dir, "task-tracker-hook.js");
  copyFileSync(bundledHook, hookPath);

  const payload = JSON.stringify({
    session_id: "standalone",
    cwd: "/proj",
    hook_event_name: "SessionStart",
    source: "startup",
  });
  const result = spawnSync(process.execPath, [hookPath], {
    input: payload,
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_TASK_TRACKER_DIR: dir },
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = JSON.parse(readFileSync(join(dir, "standalone.json"), "utf-8")) as { activity?: { summary?: string } };
  assert.equal(state.activity?.summary, "工作階段已開始");
});
