import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readResolverSettings } from "./settings.js";

function fixture(): { home: string; configDir: string; projectRoot: string } {
  const home = mkdtempSync(join(tmpdir(), "inspect-settings-"));
  const configDir = join(home, ".claude");
  const projectRoot = join(home, "proj");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(projectRoot, ".claude"), { recursive: true });
  return { home, configDir, projectRoot };
}

test("local 的 scalar 蓋過 project 與 user，excludes 則串接去重", () => {
  const dirs = fixture();
  writeFileSync(
    join(dirs.configDir, "settings.json"),
    JSON.stringify({
      autoMemoryEnabled: true,
      autoMemoryDirectory: "/from-user",
      claudeMdExcludes: ["**/user.md", "**/shared.md"],
    }),
  );
  writeFileSync(
    join(dirs.projectRoot, ".claude", "settings.json"),
    JSON.stringify({
      autoMemoryEnabled: false,
      autoMemoryDirectory: "/from-project",
      claudeMdExcludes: ["**/project.md", "**/shared.md"],
    }),
  );
  writeFileSync(
    join(dirs.projectRoot, ".claude", "settings.local.json"),
    JSON.stringify({
      autoMemoryDirectory: "~/from-local",
      claudeMdExcludes: ["**/local.md"],
    }),
  );

  const settings = readResolverSettings({ ...dirs, cwd: dirs.projectRoot, env: {} });
  assert.equal(settings.autoMemoryEnabled, false);
  assert.equal(settings.autoMemoryDirectory, join(dirs.home, "from-local"));
  assert.equal(settings.autoMemoryFromProjectSettings, true);
  assert.deepEqual(settings.excludes, ["**/user.md", "**/shared.md", "**/project.md", "**/local.md"]);
  assert.deepEqual(settings.warnings, []);
});

test("壞掉的 JSON 變成 warning，不讓解析失敗", () => {
  const dirs = fixture();
  writeFileSync(join(dirs.configDir, "settings.json"), "{");
  const settings = readResolverSettings({ ...dirs, cwd: dirs.projectRoot, env: {} });
  assert.equal(settings.autoMemoryEnabled, true);
  assert.equal(settings.warnings.length, 1);
  assert.match(settings.warnings[0], /無法解析設定檔，已略過/);
});

test("CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 關閉，0 則強制開啟", () => {
  const dirs = fixture();
  writeFileSync(
    join(dirs.projectRoot, ".claude", "settings.json"),
    JSON.stringify({ autoMemoryEnabled: false }),
  );
  const off = readResolverSettings({
    ...dirs,
    cwd: dirs.projectRoot,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
  });
  const forced = readResolverSettings({
    ...dirs,
    cwd: dirs.projectRoot,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" },
  });
  assert.equal(off.autoMemoryEnabled, false);
  assert.equal(forced.autoMemoryEnabled, true);
});
