import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectProjectPromptEntries } from "./prompt-files.js";

test("excludes 命中的 prompt 檔案標成 excluded，仍會列出", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-files-exclude-"));
  const project = join(root, "repo");
  const configDir = join(root, "config");
  mkdirSync(join(project, ".claude", "commands"), { recursive: true });
  mkdirSync(configDir);
  const target = join(project, ".claude", "commands", "secret.md");
  writeFileSync(target, "secret\n");

  const entries = collectProjectPromptEntries({
    cwd: project,
    projectRoot: project,
    configDir,
    excludes: ["**/commands/**"],
    already: new Set(),
  });

  const entry = entries.find((item) => item.absolutePath.endsWith(join("commands", "secret.md")));
  assert.equal(entry?.status, "excluded");
});

test("指到專案與 config 之外的 prompt 檔案標成 external，不讀內容", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-files-link-"));
  const project = join(root, "repo");
  const configDir = join(root, "config");
  const outside = join(root, "outside.md");
  mkdirSync(join(project, ".claude", "agents"), { recursive: true });
  mkdirSync(configDir);
  writeFileSync(outside, "outside\n");
  const linked = join(project, ".claude", "agents", "linked.md");
  symlinkSync(outside, linked);

  const entries = collectProjectPromptEntries({
    cwd: project,
    projectRoot: project,
    configDir,
    excludes: [],
    already: new Set(),
  });

  const entry = entries.find((item) => item.absolutePath.endsWith(join("agents", "linked.md")));
  assert.equal(entry?.status, "external");
  assert.equal(entry?.detail, "外部，可能尚未核准");
});

test("already 集合裡的路徑不重複列出", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-files-dedup-"));
  const project = join(root, "repo");
  const configDir = join(root, "config");
  mkdirSync(project, { recursive: true });
  mkdirSync(configDir);
  const claudeMd = join(project, "CLAUDE.md");
  writeFileSync(claudeMd, "hi\n");

  const entries = collectProjectPromptEntries({
    cwd: project,
    projectRoot: project,
    configDir,
    excludes: [],
    already: new Set([claudeMd]),
  });

  assert.equal(entries.some((item) => item.absolutePath.endsWith("CLAUDE.md")), false);
});

test("cwd 之外、專案內的技能歸類 outOfSession，cwd 底下的歸類 onDemand", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-files-session-"));
  const project = join(root, "repo");
  const cwd = join(project, "packages", "web");
  const configDir = join(root, "config");
  mkdirSync(join(cwd, ".claude", "skills", "web-skill"), { recursive: true });
  mkdirSync(join(project, "packages", "api", ".claude", "skills", "api-skill"), { recursive: true });
  mkdirSync(configDir);
  const webSkill = join(cwd, ".claude", "skills", "web-skill", "SKILL.md");
  const apiSkill = join(project, "packages", "api", ".claude", "skills", "api-skill", "SKILL.md");
  writeFileSync(webSkill, "web\n");
  writeFileSync(apiSkill, "api\n");

  const entries = collectProjectPromptEntries({
    cwd,
    projectRoot: project,
    configDir,
    excludes: [],
    already: new Set(),
  });

  assert.equal(
    entries.find((item) => item.absolutePath.endsWith(join("web-skill", "SKILL.md")))?.section,
    "onDemand",
  );
  assert.equal(
    entries.find((item) => item.absolutePath.endsWith(join("api-skill", "SKILL.md")))?.section,
    "outOfSession",
  );
});
