import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  defaultManagedPolicyPath,
  encodeProjectSlug,
  findGitCommonRoot,
  findWorktreeRoot,
  isInside,
  resolveConfigDir,
} from "./paths.js";

test("resolveConfigDir 預設是家目錄下的 .claude，有 CLAUDE_CONFIG_DIR 就用它", () => {
  assert.equal(resolveConfigDir({}, "/Users/me"), "/Users/me/.claude");
  assert.equal(
    resolveConfigDir({ CLAUDE_CONFIG_DIR: "/custom/claude" }, "/Users/me"),
    "/custom/claude",
  );
});

test("defaultManagedPolicyPath 依平台回傳官方路徑", () => {
  assert.equal(
    defaultManagedPolicyPath("darwin"),
    "/Library/Application Support/ClaudeCode/CLAUDE.md",
  );
  assert.equal(defaultManagedPolicyPath("linux"), "/etc/claude-code/CLAUDE.md");
  assert.equal(
    defaultManagedPolicyPath("win32"),
    "C:\\Program Files\\ClaudeCode\\CLAUDE.md",
  );
});

test("encodeProjectSlug 把每個非英數變成連字號", () => {
  assert.equal(
    encodeProjectSlug("/Users/me/my_app"),
    "-Users-me-my-app",
  );
});

test("isInside 只接受 root 自己或它的子路徑", () => {
  assert.equal(isInside("/proj", "/proj"), true);
  assert.equal(isInside("/proj", "/proj/src/a.md"), true);
  assert.equal(isInside("/proj", "/proj-other/a.md"), false);
  assert.equal(isInside("/proj", "/elsewhere/a.md"), false);
});

test("worktree 與主 repo 共用 git common root，worktree root 則是各自的 checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-git-"));
  const main = join(root, "main");
  mkdirSync(main);
  const git = (cwd: string, args: string[]) => {
    const result = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git(main, ["init"]);
  writeFileSync(join(main, "README.md"), "hi\n");
  git(main, ["add", "README.md"]);
  git(main, ["commit", "-m", "init"]);
  const linked = join(root, "linked");
  git(main, ["worktree", "add", linked, "-b", "linked"]);

  const mainReal = realpathSync(main);
  const linkedReal = realpathSync(linked);
  assert.equal(findGitCommonRoot(main), mainReal);
  assert.equal(findGitCommonRoot(linked), mainReal);
  assert.equal(findWorktreeRoot(linked), linkedReal);
  assert.equal(findGitCommonRoot(root), null);
  assert.equal(findWorktreeRoot(root), null);
});
