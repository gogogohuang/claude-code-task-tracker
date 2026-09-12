import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { extractImports } from "./markdown.js";
import { isInside } from "./paths.js";
import { InspectEntry } from "./types.js";

const FOUR_MIB = 4 * 1024 * 1024;
const MAX_DEPTH = 4;

function identity(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function skippedClaudeMd(path: string): boolean {
  const name = basename(path);
  if (name !== "CLAUDE.md" && name !== "CLAUDE.local.md") return false;
  try {
    return statSync(path).size > FOUR_MIB;
  } catch {
    return false;
  }
}

export function expandImports(entries: InspectEntry[], input: {
  cwd: string;
  configDir: string;
  home: string;
}): InspectEntry[] {
  const output: InspectEntry[] = [];
  const expandAfter = (source: InspectEntry, depth: number, chain: Set<string>) => {
    if (source.section !== "launch" || source.status !== "present" || depth >= MAX_DEPTH) return;
    let markdown = "";
    try {
      markdown = readFileSync(source.absolutePath, "utf8");
    } catch {
      return;
    }
    for (const ref of extractImports(markdown, source.absolutePath, input.home)) {
      const allowed = isInside(input.cwd, ref.resolvedPath) || isInside(input.configDir, ref.resolvedPath);
      const key = identity(ref.resolvedPath);
      if (chain.has(key)) continue;
      const nextChain = new Set(chain);
      nextChain.add(key);
      const imported: InspectEntry = {
        id: `launch:import:${ref.resolvedPath}:${source.absolutePath}`,
        section: "launch",
        label: "匯入",
        absolutePath: ref.resolvedPath,
        status: "missing",
        detail: allowed ? `由 ${basename(source.absolutePath)} 匯入` : "外部，可能尚未核准",
        importedBy: source.absolutePath,
      };
      if (!allowed) {
        imported.status = "external";
        output.push(imported);
        continue;
      }
      if (existsSync(ref.resolvedPath) && !skippedClaudeMd(ref.resolvedPath)) {
        imported.status = "present";
      } else if (skippedClaudeMd(ref.resolvedPath)) {
        imported.status = "skipped-too-large";
      }
      output.push(imported);
      if (imported.status === "present") expandAfter(imported, depth + 1, nextChain);
    }
  };

  for (const item of entries) {
    output.push(item);
    const chain = new Set([identity(item.absolutePath)]);
    expandAfter(item, 0, chain);
  }
  return output;
}
