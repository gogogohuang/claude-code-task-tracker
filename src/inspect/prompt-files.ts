import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { matchExclude } from "./glob.js";
import { isInside } from "./paths.js";
import { InspectEntry } from "./types.js";
import { walkProjectFiles } from "./walk.js";

const FOUR_MIB = 4 * 1024 * 1024;

type PromptKind =
  | "claude"
  | "localClaude"
  | "rule"
  | "skill"
  | "command"
  | "agent"
  | "outputStyle"
  | "workflow"
  | "agentMemory";

const LABEL: Record<PromptKind, string> = {
  claude: "CLAUDE.md",
  localClaude: "CLAUDE.local.md",
  rule: "規則",
  skill: "技能",
  command: "指令",
  agent: "子代理",
  outputStyle: "輸出風格",
  workflow: "工作流程",
  agentMemory: "子代理記憶",
};

function identity(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function promptKind(absolutePath: string): PromptKind | null {
  const parts = absolutePath.split(sep);
  const claudeAt = parts.lastIndexOf(".claude");
  const name = basename(absolutePath);
  if (claudeAt === -1) {
    if (name === "CLAUDE.md") return "claude";
    if (name === "CLAUDE.local.md") return "localClaude";
    return null;
  }
  const category = parts[claudeAt + 1];
  if (category === "CLAUDE.md") return "claude";
  if (category === "CLAUDE.local.md") return "localClaude";
  if (category === "rules" && name.endsWith(".md")) return "rule";
  if (category === "skills" && name === "SKILL.md") return "skill";
  if (category === "commands" && name.endsWith(".md")) return "command";
  if (category === "agents" && name.endsWith(".md")) return "agent";
  if (category === "output-styles" && name.endsWith(".md")) return "outputStyle";
  if (category === "workflows" && name.endsWith(".js")) return "workflow";
  if (category === "agent-memory" && name.endsWith(".md")) return "agentMemory";
  return null;
}

function promptOwnerDir(file: string): string | null {
  const parts = file.split(sep);
  const claudeAt = parts.lastIndexOf(".claude");
  if (claudeAt >= 0) {
    if (claudeAt === 0) return sep;
    return parts.slice(0, claudeAt).join(sep);
  }
  const name = basename(file);
  if (name === "CLAUDE.md" || name === "CLAUDE.local.md") return dirname(file);
  return null;
}

function isSessionReachable(file: string, cwd: string, projectRoot: string): boolean {
  const start = identity(cwd);
  const root = identity(projectRoot);
  const path = identity(file);
  if (isInside(start, path)) return true;
  const owner = promptOwnerDir(path);
  if (!owner) return false;
  if (!isInside(owner, start)) return false;
  return isInside(root, owner);
}

function externalTarget(path: string, projectRoot: string, configDir: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    const target = realpathSync(path);
    return !isInside(identity(projectRoot), target) && !isInside(identity(configDir), target);
  } catch {
    return false;
  }
}

function entryFor(input: {
  path: string;
  kind: PromptKind;
  cwd: string;
  projectRoot: string;
  configDir: string;
  excludes: string[];
  userLevel: boolean;
}): InspectEntry {
  const reachable = input.userLevel || isSessionReachable(input.path, input.cwd, input.projectRoot);
  const section = reachable ? "onDemand" : "outOfSession";
  const label = input.userLevel ? `使用者${LABEL[input.kind]}` : LABEL[input.kind];
  if (externalTarget(input.path, input.projectRoot, input.configDir)) {
    return {
      id: `${section}:${input.path}`,
      section,
      label,
      absolutePath: input.path,
      status: "external",
      detail: "外部，可能尚未核准",
    };
  }
  const excluded = input.excludes.some((pattern) => matchExclude(pattern, input.path));
  let status: InspectEntry["status"] = excluded ? "excluded" : "present";
  if (!excluded && (input.kind === "claude" || input.kind === "localClaude")) {
    try {
      if (statSync(input.path).size > FOUR_MIB) status = "skipped-too-large";
    } catch {
      status = "present";
    }
  }
  return {
    id: `${section}:${input.path}`,
    section,
    label,
    absolutePath: input.path,
    status,
    detail: section === "outOfSession" ? "此目錄不會載入" : undefined,
  };
}

const USER_CATEGORIES: { dir: string; kind: PromptKind; accept: (name: string) => boolean }[] = [
  { dir: "skills", kind: "skill", accept: (name) => name === "SKILL.md" },
  { dir: "commands", kind: "command", accept: (name) => name.endsWith(".md") },
  { dir: "agents", kind: "agent", accept: (name) => name.endsWith(".md") },
  { dir: "output-styles", kind: "outputStyle", accept: (name) => name.endsWith(".md") },
  { dir: "workflows", kind: "workflow", accept: (name) => name.endsWith(".js") },
  { dir: "agent-memory", kind: "agentMemory", accept: (name) => name.endsWith(".md") },
];

export function collectProjectPromptEntries(input: {
  cwd: string;
  projectRoot: string;
  configDir: string;
  excludes: string[];
  already: ReadonlySet<string>;
}): InspectEntry[] {
  const seen = new Set([...input.already].map(identity));
  const found: InspectEntry[] = [];
  for (const path of walkProjectFiles(identity(input.projectRoot))) {
    const kind = promptKind(path);
    if (!kind) continue;
    const key = identity(path);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(entryFor({ ...input, path, kind, userLevel: false }));
  }
  for (const category of USER_CATEGORIES) {
    for (const path of walkProjectFiles(join(input.configDir, category.dir))) {
      if (!category.accept(basename(path))) continue;
      const key = identity(path);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(entryFor({ ...input, path, kind: category.kind, userLevel: true }));
    }
  }
  return found;
}
