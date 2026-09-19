import { join } from "node:path";

export function codexConfigPath(home: string): string {
  return join(home, ".codex", "config.toml");
}

/** 只在 [features] 區段明確寫 `hooks = false` 才回 true；讀不懂一律 false（不擋安裝）。 */
export function codexHooksDisabled(toml: string): boolean {
  let section = "";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section === "features" && /^hooks\s*=\s*false\b/.test(line)) return true;
  }
  return false;
}
