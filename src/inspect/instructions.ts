import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { walkProjectFiles } from "./walk.js";
import { matchExclude } from "./glob.js";
import { readRulePaths } from "./markdown.js";
import { isInside } from "./paths.js";
import { InspectEntry, InspectStatus } from "./types.js";

const FOUR_MIB = 4 * 1024 * 1024;

function entry(input: {
  section: InspectEntry["section"];
  label: string;
  absolutePath: string;
  status: InspectStatus;
  detail?: string;
}): InspectEntry {
  return {
    id: `${input.section}:${input.absolutePath}`,
    section: input.section,
    label: input.label,
    absolutePath: input.absolutePath,
    status: input.status,
    detail: input.detail,
  };
}

function ancestors(cwd: string): string[] {
  const found: string[] = [];
  let dir = dirname(resolve(cwd));
  while (true) {
    found.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found.reverse();
}

function ruleFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name))
    .sort();
}

function externalTarget(path: string, cwd: string, configDir: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    const target = realpathSync(path);
    return !isInside(cwd, target) && !isInside(configDir, target);
  } catch {
    return false;
  }
}

function claudeStatus(path: string, exists: boolean): InspectStatus {
  if (!exists) return "missing";
  const name = basename(path);
  if ((name === "CLAUDE.md" || name === "CLAUDE.local.md") && statSync(path).size > FOUR_MIB) {
    return "skipped-too-large";
  }
  return "present";
}

function applyExclude(item: InspectEntry, excludes: string[], protectedPath?: string): InspectEntry {
  if (protectedPath && item.absolutePath === protectedPath) return item;
  if (excludes.some((pattern) => matchExclude(pattern, item.absolutePath))) {
    return { ...item, status: "excluded" };
  }
  return item;
}

function classifyRule(
  path: string,
  label: string,
  cwd: string,
  configDir: string,
  forceOnDemand: boolean,
): InspectEntry {
  if (externalTarget(path, cwd, configDir)) {
    return entry({
      section: forceOnDemand ? "onDemand" : "launch",
      label,
      absolutePath: path,
      status: "external",
      detail: "外部，可能尚未核准",
    });
  }
  let paths: string[] | null = null;
  try {
    paths = readRulePaths(readFileSync(path, "utf8"));
  } catch {
    paths = null;
  }
  const onDemand = forceOnDemand || paths !== null;
  return entry({
    section: onDemand ? "onDemand" : "launch",
    label,
    absolutePath: path,
    status: "present",
    detail: paths && paths.length > 0 ? paths.join(", ") : undefined,
  });
}

export function collectInstructionEntries(input: {
  cwd: string;
  configDir: string;
  managedPolicyPath: string;
  excludes: string[];
}): InspectEntry[] {
  const cwd = resolve(input.cwd);
  const launch: InspectEntry[] = [];
  const onDemand: InspectEntry[] = [];
  const push = (item: InspectEntry) => {
    (item.section === "launch" ? launch : onDemand).push(item);
  };

  push(
    applyExclude(
      entry({
        section: "launch",
        label: "組織政策",
        absolutePath: input.managedPolicyPath,
        status: existsSync(input.managedPolicyPath) ? "present" : "missing",
      }),
      input.excludes,
      input.managedPolicyPath,
    ),
  );

  const userClaude = join(input.configDir, "CLAUDE.md");
  push(
    applyExclude(
      entry({
        section: "launch",
        label: "使用者 CLAUDE.md",
        absolutePath: userClaude,
        status: claudeStatus(userClaude, existsSync(userClaude)),
      }),
      input.excludes,
    ),
  );

  for (const path of ruleFiles(join(input.configDir, "rules"))) {
    push(applyExclude(classifyRule(path, "使用者規則", cwd, input.configDir, false), input.excludes));
  }

  for (const dir of ancestors(cwd)) {
    for (const [name, label] of [
      ["CLAUDE.md", "上層 CLAUDE.md"],
      ["CLAUDE.local.md", "上層 CLAUDE.local.md"],
    ] as const) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      push(applyExclude(entry({
        section: "launch",
        label,
        absolutePath: path,
        status: claudeStatus(path, true),
      }), input.excludes));
    }
    for (const path of ruleFiles(join(dir, ".claude", "rules"))) {
      push(applyExclude(classifyRule(path, "上層規則", cwd, input.configDir, false), input.excludes));
    }
  }

  for (const [relativePath, label] of [
    ["CLAUDE.md", "CLAUDE.md"],
    [join(".claude", "CLAUDE.md"), ".claude/CLAUDE.md"],
    ["CLAUDE.local.md", "CLAUDE.local.md"],
  ] as const) {
    const path = join(cwd, relativePath);
    push(
      applyExclude(
        entry({
          section: "launch",
          label,
          absolutePath: path,
          status: claudeStatus(path, existsSync(path)),
        }),
        input.excludes,
      ),
    );
  }

  for (const path of ruleFiles(join(cwd, ".claude", "rules"))) {
    push(applyExclude(classifyRule(path, "規則", cwd, input.configDir, false), input.excludes));
  }

  const seen = new Set([...launch, ...onDemand].map((item) => item.absolutePath));
  for (const path of walkProjectFiles(cwd)) {
    if (seen.has(path)) continue;
    const name = basename(path);
    if (name === "CLAUDE.md" || name === "CLAUDE.local.md") {
      push(applyExclude(entry({
        section: "onDemand",
        label: name === "CLAUDE.md" ? "子目錄 CLAUDE.md" : "子目錄 CLAUDE.local.md",
        absolutePath: path,
        status: "present",
      }), input.excludes));
      continue;
    }
    if (name.endsWith(".md") && path.includes(`${sep}.claude${sep}rules${sep}`)) {
      push(applyExclude(classifyRule(path, "子目錄規則", cwd, input.configDir, true), input.excludes));
    }
  }

  return [...launch, ...onDemand];
}
