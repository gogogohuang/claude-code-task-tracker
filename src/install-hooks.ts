import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Agent } from "./agent.js";
import { writeFileAtomic } from "./fs-atomic.js";

export const HOOK_MATCHER = "*";
export const TRACKER_HOOK_FILENAME = "task-tracker-hook.js";
const HOOK_TIMEOUT_SECONDS = 5;

export interface ClaudeHookEntry {
  type: string;
  command: string;
  timeout?: number;
}
export interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}
export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: ClaudeHookGroup[];
    PostToolUse?: ClaudeHookGroup[];
    SessionStart?: ClaudeHookGroup[];
    TaskCreated?: ClaudeHookGroup[];
    TaskCompleted?: ClaudeHookGroup[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type HookScope = "user" | "project";

type HookEvent = "PreToolUse" | "PostToolUse" | "SessionStart" | "TaskCreated" | "TaskCompleted";

interface AgentProfile {
  configDir: string;
  configFile: string;
  matcherEvents: readonly HookEvent[];
  bareEvents: readonly HookEvent[];
}

const AGENT_PROFILES: Record<Agent, AgentProfile> = {
  claude: {
    configDir: ".claude",
    configFile: "settings.json",
    matcherEvents: ["PreToolUse", "PostToolUse", "SessionStart"],
    bareEvents: ["TaskCreated", "TaskCompleted"],
  },
  // Codex 現有 hooks.json 條目都沒有 matcher；Task 系列事件 Codex 不存在。
  codex: {
    configDir: ".codex",
    configFile: "hooks.json",
    matcherEvents: [],
    bareEvents: ["SessionStart", "PreToolUse", "PostToolUse"],
  },
};

const ClaudeHookEntrySchema = z
  .object({ type: z.string(), command: z.string(), timeout: z.number().optional() })
  .passthrough();
const ClaudeHookGroupSchema = z
  .object({ matcher: z.string().optional(), hooks: z.array(ClaudeHookEntrySchema) })
  .passthrough();
/** 只驗證 stripTrackerHooks 實際會走訪的已知 hook 事件；其他任意欄位放行。 */
const ClaudeSettingsSchema = z
  .object({
    hooks: z
      .object({
        PreToolUse: z.array(ClaudeHookGroupSchema).optional(),
        PostToolUse: z.array(ClaudeHookGroupSchema).optional(),
        SessionStart: z.array(ClaudeHookGroupSchema).optional(),
        TaskCreated: z.array(ClaudeHookGroupSchema).optional(),
        TaskCompleted: z.array(ClaudeHookGroupSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function isTrackerHookCommand(command: string): boolean {
  return command.includes("task-tracker-hook");
}

export function buildHookCommand(execPath: string, hookScriptPath: string, agent: Agent = "claude"): string {
  const base = `${JSON.stringify(execPath)} ${JSON.stringify(hookScriptPath)}`;
  return agent === "codex" ? `${base} --agent codex` : base;
}

export function installedHookPath(stateDir: string): string {
  return join(stateDir, TRACKER_HOOK_FILENAME);
}

export function settingsPathFor(
  scope: HookScope,
  input: { home: string; cwd: string },
  agent: Agent = "claude",
): string {
  const { configDir, configFile } = AGENT_PROFILES[agent];
  return join(scope === "user" ? input.home : input.cwd, configDir, configFile);
}

/**
 * dist/cli.js 旁邊就是 dist/hook/；tsx 跑 src 時改找套件根目錄的 dist。
 */
export function resolveBundledHookPath(fromMetaUrl: string = import.meta.url): string {
  const here = dirname(fileURLToPath(fromMetaUrl));
  const besideCli = join(here, "hook", TRACKER_HOOK_FILENAME);
  if (existsSync(besideCli)) return besideCli;
  return join(here, "..", "dist", "hook", TRACKER_HOOK_FILENAME);
}

function stripTrackerHooks(groups: ClaudeHookGroup[] | undefined): ClaudeHookGroup[] {
  return (groups ?? [])
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((hook) => !isTrackerHookCommand(hook.command)),
    }))
    .filter((group) => group.hooks.length > 0);
}

function trackerGroup(hookCommand: string, matcher?: string): ClaudeHookGroup {
  const group: ClaudeHookGroup = {
    hooks: [{ type: "command", command: hookCommand, timeout: HOOK_TIMEOUT_SECONDS }],
  };
  if (matcher) group.matcher = matcher;
  return group;
}

export function mergeTrackerHooks(settings: ClaudeSettings, hookCommand: string, agent: Agent = "claude"): ClaudeSettings {
  const profile = AGENT_PROFILES[agent];
  const hooks: NonNullable<ClaudeSettings["hooks"]> = { ...settings.hooks };
  for (const event of profile.matcherEvents) {
    hooks[event] = [...stripTrackerHooks(hooks[event]), trackerGroup(hookCommand, HOOK_MATCHER)];
  }
  for (const event of profile.bareEvents) {
    hooks[event] = [...stripTrackerHooks(hooks[event]), trackerGroup(hookCommand)];
  }
  return { ...settings, hooks };
}

export function readSettingsFile(settingsPath: string): { ok: true; settings: ClaudeSettings } | { ok: false; error: string } {
  if (!existsSync(settingsPath)) return { ok: true, settings: {} };
  const parseError = { ok: false as const, error: `無法解析既有的 ${settingsPath}，請手動檢查後再執行 init。` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return parseError;
  }
  const result = ClaudeSettingsSchema.safeParse(parsed);
  if (!result.success) return parseError;
  return { ok: true, settings: result.data as ClaudeSettings };
}

export function writeSettingsFile(settingsPath: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

export function hasTrackerHookInstalled(
  scope: HookScope,
  input: { home: string; cwd: string },
  agent: Agent = "claude",
): boolean {
  const loaded = readSettingsFile(settingsPathFor(scope, input, agent));
  if (!loaded.ok) return false;
  const hooks = loaded.settings.hooks;
  if (!hooks) return false;
  return Object.values(hooks).some(
    (groups) =>
      Array.isArray(groups) &&
      (groups as ClaudeHookGroup[]).some((group) => group.hooks.some((hook) => isTrackerHookCommand(hook.command))),
  );
}

export type InstallResult =
  | { ok: true; settingsPath: string; already: boolean }
  | { ok: false; error: string };

export function installTrackerHooks(input: {
  scope: HookScope;
  home: string;
  cwd: string;
  execPath: string;
  bundledHookPath: string;
  stateDir: string;
  agent?: Agent;
}): InstallResult {
  const agent = input.agent ?? "claude";
  if (!existsSync(input.bundledHookPath)) {
    return { ok: false, error: `找不到 hook 腳本：${input.bundledHookPath}。請先執行 build。` };
  }
  mkdirSync(input.stateDir, { recursive: true });
  copyFileSync(input.bundledHookPath, installedHookPath(input.stateDir));

  const settingsPath = settingsPathFor(input.scope, input, agent);
  const loaded = readSettingsFile(settingsPath);
  if (!loaded.ok) return loaded;

  const hookCommand = buildHookCommand(input.execPath, installedHookPath(input.stateDir), agent);
  const merged = mergeTrackerHooks(loaded.settings, hookCommand, agent);
  const already = JSON.stringify(loaded.settings.hooks) === JSON.stringify(merged.hooks);
  if (!already) writeSettingsFile(settingsPath, merged);
  return { ok: true, settingsPath, already };
}
