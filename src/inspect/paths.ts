import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function resolveConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.CLAUDE_CONFIG_DIR;
  if (override && override.length > 0) return resolve(override);
  return join(home, ".claude");
}

export function defaultManagedPolicyPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}

export function encodeProjectSlug(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, "-");
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  return text.length > 0 ? text : null;
}

function existingDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** 主 checkout。linked worktree 也回傳主 repo，讓 auto memory 共用。不是 git repo 就回 null。 */
export function findGitCommonRoot(cwd: string): string | null {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) return null;
  if (basename(common) === ".git") return existingDir(dirname(common));
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  return toplevel ? existingDir(toplevel) : null;
}

/** 目前這個 checkout。worktree 回傳 worktree 自己，用來找 .claude/settings.json。 */
export function findWorktreeRoot(cwd: string): string | null {
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  return toplevel ? existingDir(toplevel) : null;
}
