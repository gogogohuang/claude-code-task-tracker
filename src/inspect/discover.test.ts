import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverInspectModel } from "./discover.js";

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
