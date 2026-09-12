import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface ResolverSettings {
  excludes: string[];
  autoMemoryEnabled: boolean;
  autoMemoryDirectory?: string;
  autoMemoryFromProjectSettings: boolean;
  warnings: string[];
}

interface SettingsFile {
  claudeMdExcludes?: string[];
  autoMemoryEnabled?: boolean;
  autoMemoryDirectory?: string;
}

function readOne(path: string, warnings: string[]): SettingsFile | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    warnings.push(`無法解析設定檔，已略過：${path}`);
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`無法解析設定檔，已略過：${path}`);
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const file: SettingsFile = {};
  if (Array.isArray(obj.claudeMdExcludes) && obj.claudeMdExcludes.every((item) => typeof item === "string")) {
    file.claudeMdExcludes = obj.claudeMdExcludes;
  }
  if (typeof obj.autoMemoryEnabled === "boolean") file.autoMemoryEnabled = obj.autoMemoryEnabled;
  if (typeof obj.autoMemoryDirectory === "string") file.autoMemoryDirectory = obj.autoMemoryDirectory;
  return file;
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

export function readResolverSettings(input: {
  cwd: string;
  configDir: string;
  home: string;
  env: NodeJS.ProcessEnv;
  projectRoot: string;
}): ResolverSettings {
  void input.cwd;
  const warnings: string[] = [];
  const layers: Array<{ source: "user" | "project" | "local"; file?: SettingsFile }> = [
    { source: "user", file: readOne(join(input.configDir, "settings.json"), warnings) },
    { source: "project", file: readOne(join(input.projectRoot, ".claude", "settings.json"), warnings) },
    { source: "local", file: readOne(join(input.projectRoot, ".claude", "settings.local.json"), warnings) },
  ];

  const excludes: string[] = [];
  for (const layer of layers) {
    for (const pattern of layer.file?.claudeMdExcludes ?? []) {
      if (!excludes.includes(pattern)) excludes.push(pattern);
    }
  }

  let autoMemoryEnabled = true;
  let autoMemoryDirectory: string | undefined;
  let autoMemoryFromProjectSettings = false;
  for (const layer of layers) {
    if (layer.file?.autoMemoryEnabled !== undefined) autoMemoryEnabled = layer.file.autoMemoryEnabled;
    if (layer.file?.autoMemoryDirectory !== undefined) {
      const expanded = expandHome(layer.file.autoMemoryDirectory, input.home);
      if (!isAbsolute(expanded)) {
        warnings.push(`autoMemoryDirectory 路徑無效，已略過：${layer.file.autoMemoryDirectory}`);
      } else {
        autoMemoryDirectory = expanded;
        autoMemoryFromProjectSettings = layer.source !== "user";
      }
    }
  }

  const disable = input.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  if (disable === "1") autoMemoryEnabled = false;
  if (disable === "0" || disable === "false") autoMemoryEnabled = true;

  return { excludes, autoMemoryEnabled, autoMemoryDirectory, autoMemoryFromProjectSettings, warnings };
}
