import { dirname, isAbsolute, join, resolve } from "node:path";

export interface ImportRef {
  raw: string;
  resolvedPath: string;
}

function expandImportPath(raw: string, fromFile: string, home: string): string {
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return resolve(join(home, raw.slice(2)));
  if (isAbsolute(raw)) return resolve(raw);
  return resolve(dirname(fromFile), raw);
}

export function extractImports(markdown: string, fromFile: string, home: string): ImportRef[] {
  const refs: ImportRef[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let index = 0;
    let inSpan = false;
    while (index < line.length) {
      const char = line[index];
      if (char === "`") {
        inSpan = !inSpan;
        index += 1;
        continue;
      }
      const prev = index === 0 ? " " : line[index - 1];
      if (!inSpan && char === "@" && /\s/.test(prev)) {
        let end = index + 1;
        while (end < line.length && !/\s/.test(line[end]) && line[end] !== "`") end += 1;
        let raw = line.slice(index + 1, end);
        raw = raw.replace(/[.,;:)]+$/g, "");
        if (raw.length > 0) {
          refs.push({ raw, resolvedPath: expandImportPath(raw, fromFile, home) });
        }
        index = end;
        continue;
      }
      index += 1;
    }
  }
  return refs;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function readRulePaths(markdown: string): string[] | null {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") return null;
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return null;
  const frontmatter = normalized.slice(4, end).split("\n");
  const pathsIndex = frontmatter.findIndex((line) => line.trim() === "paths:" || line.trim().startsWith("paths:"));
  if (pathsIndex === -1) return null;
  const header = frontmatter[pathsIndex].trim();
  if (header !== "paths:") {
    const inline = unquote(header.slice("paths:".length));
    return inline.length > 0 ? [inline] : [];
  }
  const paths: string[] = [];
  for (const line of frontmatter.slice(pathsIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) break;
    const item = unquote(trimmed.slice(2));
    if (item.length > 0) paths.push(item);
  }
  return paths;
}
