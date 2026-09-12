import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectInstructionEntries } from "./instructions.js";

test("collectInstructionEntries 留五格空列，祖先與按需規則只在有檔時出現", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-files-"));
  const cwd = join(root, "repo", "pkg");
  mkdirSync(join(cwd, "nested", ".claude", "rules"), { recursive: true });
  mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
  mkdirSync(join(root, "repo", ".claude", "rules"), { recursive: true });
  const configDir = join(root, "config");
  mkdirSync(join(configDir, "rules"), { recursive: true });

  writeFileSync(join(configDir, "CLAUDE.md"), "user\n");
  writeFileSync(join(configDir, "rules", "always.md"), "always\n");
  writeFileSync(join(configDir, "rules", "api.md"), "---\npaths:\n  - src/**/*.ts\n---\napi\n");
  writeFileSync(join(root, "repo", "CLAUDE.md"), "parent\n");
  writeFileSync(join(cwd, ".claude", "rules", "local.md"), "local\n");
  writeFileSync(join(cwd, "nested", "CLAUDE.md"), "nested\n");
  writeFileSync(join(cwd, "nested", ".claude", "rules", "later.md"), "later\n");

  const entries = collectInstructionEntries({
    cwd,
    configDir,
    managedPolicyPath: join(root, "missing-policy.md"),
    excludes: [],
  });

  assert.equal(entries[0]?.label, "組織政策");
  assert.equal(entries[1]?.label, "使用者 CLAUDE.md");
  assert.equal(entries.find((entry) => entry.absolutePath === join(root, "repo", "CLAUDE.md"))?.label, "上層 CLAUDE.md");
  for (const label of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
    assert.equal(entries.some((entry) => entry.label === label), true);
  }
  assert.equal(entries.find((entry) => entry.label === "組織政策")?.status, "missing");
  assert.equal(entries.find((entry) => entry.label === "CLAUDE.md")?.status, "missing");
  assert.equal(entries.some((entry) => entry.absolutePath.endsWith("CLAUDE.local.md") && entry.status === "missing"), true);
  assert.equal(entries.some((entry) => entry.label === "規則" && entry.section === "launch"), true);
  assert.equal(entries.some((entry) => entry.label === "使用者規則" && entry.section === "onDemand" && entry.detail === "src/**/*.ts"), true);
  assert.equal(entries.some((entry) => entry.label === "子目錄 CLAUDE.md"), true);
  assert.equal(entries.some((entry) => entry.label === "子目錄規則"), true);
});

test("指到專案與 config 之外的 rule symlink 標成外部且不讀", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-link-"));
  const cwd = join(root, "proj");
  const configDir = join(root, "config");
  const outside = join(root, "outside.md");
  mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
  mkdirSync(configDir);
  writeFileSync(outside, "---\npaths:\n  - secret\n---\nsecret\n");
  symlinkSync(outside, join(cwd, ".claude", "rules", "linked.md"));

  const entries = collectInstructionEntries({
    cwd,
    configDir,
    managedPolicyPath: join(root, "policy.md"),
    excludes: [],
  });
  const linked = entries.find((entry) => entry.absolutePath.endsWith("linked.md"));
  assert.equal(linked?.status, "external");
  assert.equal(linked?.detail, "外部，可能尚未核准");
});
