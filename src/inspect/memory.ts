import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeProjectSlug, findGitCommonRoot } from "./paths.js";
import { ResolverSettings } from "./settings.js";
import { InspectEntry } from "./types.js";

export function resolveMemoryDir(input: {
  cwd: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  settings: ResolverSettings;
}): string {
  if (input.settings.autoMemoryDirectory) return input.settings.autoMemoryDirectory;
  if (input.env.CLAUDE_CONFIG_DIR && input.env.CLAUDE_CODE_PROJECT_DIR_NAME) {
    return join(input.configDir, "projects", input.env.CLAUDE_CODE_PROJECT_DIR_NAME, "memory");
  }
  const root = findGitCommonRoot(input.cwd) ?? resolve(input.cwd);
  return join(input.configDir, "projects", encodeProjectSlug(root), "memory");
}

export function collectMemoryEntries(input: {
  cwd: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  settings: ResolverSettings;
}): InspectEntry[] {
  const memoryDir = resolveMemoryDir(input);
  if (!input.settings.autoMemoryEnabled) {
    return [{
      id: `launch:memory-disabled:${memoryDir}`,
      section: "launch",
      label: "auto memory",
      absolutePath: memoryDir,
      status: "disabled",
      detail: "未載入",
    }];
  }
  const indexPath = join(memoryDir, "MEMORY.md");
  const index: InspectEntry = {
    id: `launch:${indexPath}`,
    section: "launch",
    label: "MEMORY.md",
    absolutePath: indexPath,
    status: existsSync(indexPath) ? "present" : "missing",
    trustNote: input.settings.autoMemoryFromProjectSettings ? "來自專案設定，需已信任此資料夾" : undefined,
  };
  const topics: InspectEntry[] = [];
  if (existsSync(memoryDir)) {
    for (const name of readdirSync(memoryDir).filter((item) => item.endsWith(".md") && item !== "MEMORY.md").sort()) {
      const path = join(memoryDir, name);
      topics.push({
        id: `onDemand:${path}`,
        section: "onDemand",
        label: "memory 筆記",
        absolutePath: path,
        status: "present",
      });
    }
  }
  return [index, ...topics];
}
