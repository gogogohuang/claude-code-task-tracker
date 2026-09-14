import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverInspectModel } from "./discover.js";

function gitInit(dir: string): void {
  const result = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("discoverInspectModel 展開專案內 import，專案外只列路徑", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-import-"));
  const cwd = join(root, "proj");
  const configDir = join(root, "config");
  mkdirSync(cwd);
  mkdirSync(configDir);
  writeFileSync(join(cwd, "CLAUDE.md"), "See @docs/guide.md and @/outside/secret.md\n");
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "guide.md"), "guide\n");

  const model = discoverInspectModel({
    cwd,
    env: { CLAUDE_CONFIG_DIR: configDir },
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });

  const imported = model.entries.find((entry) => entry.importedBy?.endsWith("CLAUDE.md") && entry.absolutePath.endsWith("guide.md"));
  const external = model.entries.find((entry) => entry.status === "external" && entry.absolutePath === "/outside/secret.md");
  assert.equal(imported?.label, "匯入");
  assert.equal(imported?.status, "present");
  assert.equal(external?.detail, "外部，可能尚未核准");
  assert.equal(model.headerNotes.some((note) => note.startsWith("CLAUDE_CONFIG_DIR=")), true);
});

test("auto memory 用 git common root 的 slug，專案設定的目錄要標信任", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-memory-"));
  const cwd = join(root, "My App");
  const configDir = join(root, "config");
  mkdirSync(cwd);
  mkdirSync(join(configDir, "projects", "-tmp-replaced", "memory"), { recursive: true });
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  const custom = join(root, "custom-memory");
  mkdirSync(custom);
  writeFileSync(join(custom, "MEMORY.md"), "index\n");
  writeFileSync(join(custom, "topic.md"), "topic\n");
  writeFileSync(
    join(cwd, ".claude", "settings.json"),
    JSON.stringify({ autoMemoryDirectory: custom }),
  );

  const model = discoverInspectModel({
    cwd,
    env: {},
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });

  const index = model.entries.find((entry) => entry.label === "MEMORY.md");
  assert.equal(index?.absolutePath, join(custom, "MEMORY.md"));
  assert.equal(index?.trustNote, "來自專案設定，需已信任此資料夾");
  assert.equal(model.entries.some((entry) => entry.label === "memory 筆記" && entry.section === "onDemand"), true);
});

test("git 專案裡這次 session 不會載入的技能仍要列出", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-prompt-"));
  const project = join(root, "repo");
  const cwd = join(project, "packages", "web");
  const configDir = join(root, "config");
  mkdirSync(join(project, ".claude", "skills", "root-skill"), { recursive: true });
  mkdirSync(join(cwd, ".claude", "skills", "web-skill"), { recursive: true });
  mkdirSync(join(project, "packages", "api", ".claude", "skills", "api-skill"), { recursive: true });
  mkdirSync(configDir);
  gitInit(project);
  writeFileSync(join(project, ".claude", "skills", "root-skill", "SKILL.md"), "root\n");
  writeFileSync(join(cwd, ".claude", "skills", "web-skill", "SKILL.md"), "web\n");
  writeFileSync(join(project, "packages", "api", ".claude", "skills", "api-skill", "SKILL.md"), "api\n");
  writeFileSync(join(project, "packages", "api", "CLAUDE.md"), "api claude\n");
  writeFileSync(join(project, ".mcp.json"), "{\"mcpServers\":{}}\n");
  writeFileSync(join(project, ".claude", "settings.json"), "{}\n");

  const model = discoverInspectModel({
    cwd,
    env: { CLAUDE_CONFIG_DIR: configDir },
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });

  const apiSkill = model.entries.find((entry) => entry.absolutePath.endsWith(join("api-skill", "SKILL.md")));
  const rootSkill = model.entries.find((entry) => entry.absolutePath.endsWith(join("root-skill", "SKILL.md")));
  const webSkill = model.entries.find((entry) => entry.absolutePath.endsWith(join("web-skill", "SKILL.md")));
  const apiClaude = model.entries.find((entry) => entry.absolutePath.endsWith(join("packages", "api", "CLAUDE.md")));
  assert.equal(apiSkill?.section, "outOfSession");
  assert.equal(apiSkill?.label, "技能");
  assert.equal(apiClaude?.section, "outOfSession");
  assert.equal(rootSkill?.section, "onDemand");
  assert.equal(rootSkill?.label, "技能");
  assert.equal(webSkill?.section, "onDemand");
  assert.equal(model.entries.some((entry) => entry.absolutePath.endsWith(".mcp.json")), false);
  assert.equal(model.entries.some((entry) => entry.absolutePath.endsWith("settings.json")), false);
});

test("使用者層與專案內的指令、子代理、風格、工作流程、子代理記憶都要列出", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-kinds-"));
  const project = join(root, "repo");
  const configDir = join(root, "config");
  mkdirSync(join(project, ".claude", "commands"), { recursive: true });
  mkdirSync(join(project, ".claude", "agents"), { recursive: true });
  mkdirSync(join(project, ".claude", "output-styles"), { recursive: true });
  mkdirSync(join(project, ".claude", "workflows"), { recursive: true });
  mkdirSync(join(project, ".claude", "agent-memory", "reviewer"), { recursive: true });
  mkdirSync(join(configDir, "skills", "personal"), { recursive: true });
  mkdirSync(join(configDir, "commands"), { recursive: true });
  mkdirSync(join(configDir, "plugins", "ignored"), { recursive: true });
  gitInit(project);
  writeFileSync(join(project, ".claude", "commands", "deploy.md"), "deploy\n");
  writeFileSync(join(project, ".claude", "agents", "reviewer.md"), "review\n");
  writeFileSync(join(project, ".claude", "output-styles", "brief.md"), "brief\n");
  writeFileSync(join(project, ".claude", "workflows", "ship.js"), "export {}\n");
  writeFileSync(join(project, ".claude", "agent-memory", "reviewer", "MEMORY.md"), "notes\n");
  writeFileSync(join(configDir, "skills", "personal", "SKILL.md"), "personal\n");
  writeFileSync(join(configDir, "commands", "note.md"), "note\n");
  writeFileSync(join(configDir, "plugins", "ignored", "SKILL.md"), "plugin\n");

  const model = discoverInspectModel({
    cwd: project,
    env: { CLAUDE_CONFIG_DIR: configDir },
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });

  const bySuffix = (suffix: string) => model.entries.find((entry) => entry.absolutePath.endsWith(suffix));
  assert.equal(bySuffix(join("commands", "deploy.md"))?.label, "指令");
  assert.equal(bySuffix(join("commands", "deploy.md"))?.section, "onDemand");
  assert.equal(bySuffix(join("agents", "reviewer.md"))?.label, "子代理");
  assert.equal(bySuffix(join("output-styles", "brief.md"))?.label, "輸出風格");
  assert.equal(bySuffix(join("workflows", "ship.js"))?.label, "工作流程");
  assert.equal(bySuffix(join("agent-memory", "reviewer", "MEMORY.md"))?.label, "子代理記憶");
  assert.equal(bySuffix(join("personal", "SKILL.md"))?.label, "使用者技能");
  assert.equal(bySuffix(join("personal", "SKILL.md"))?.section, "onDemand");
  assert.equal(bySuffix(join("commands", "note.md"))?.label, "使用者指令");
  assert.equal(model.entries.some((entry) => entry.absolutePath.includes(`${join("plugins", "ignored")}`)), false);
});

test("auto memory 被關掉時不列筆記內容", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-memory-off-"));
  const cwd = join(root, "proj");
  mkdirSync(cwd);
  const model = discoverInspectModel({
    cwd,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });
  const memory = model.entries.find((entry) => entry.label === "auto memory");
  assert.equal(memory?.status, "disabled");
  assert.equal(model.entries.some((entry) => entry.label === "memory 筆記"), false);
});
