import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHookCommand,
  isTrackerHookCommand,
  mergeTrackerHooks,
  readSettingsFile,
  writeSettingsFile,
} from "./install-hooks.js";

const COMMAND = buildHookCommand("/usr/bin/node", "/home/me/.claude-task-tracker/task-tracker-hook.js");

test("buildHookCommand 用 JSON.stringify 包路徑，避免空白字元拆開", () => {
  assert.equal(
    buildHookCommand("/opt/homebrew/bin/node", "/Users/Jin Ze/.claude-task-tracker/task-tracker-hook.js"),
    `"/opt/homebrew/bin/node" "/Users/Jin Ze/.claude-task-tracker/task-tracker-hook.js"`,
  );
});

test("isTrackerHookCommand 認穩定路徑與 npx 快取裡的舊 hook", () => {
  assert.equal(isTrackerHookCommand(COMMAND), true);
  assert.equal(
    isTrackerHookCommand(
      `"/usr/bin/node" "/Users/me/.npm/_npx/abc/node_modules/claude-code-task-tracker/dist/hook/task-tracker-hook.js"`,
    ),
    true,
  );
  assert.equal(isTrackerHookCommand("bash '/Users/me/.claude/hooks/herdr-agent-state.sh' session"), false);
});

test("mergeTrackerHooks 在空設定寫入 PreToolUse、PostToolUse、SessionStart", () => {
  const merged = mergeTrackerHooks({}, COMMAND);
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart"] as const) {
    const groups = merged.hooks?.[event];
    assert.ok(groups, `${event} 應該存在`);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, "*");
    assert.deepEqual(groups[0].hooks, [{ type: "command", command: COMMAND, timeout: 5 }]);
  }
});

test("mergeTrackerHooks 為 TaskCreated 與 TaskCompleted 註冊不帶 matcher 的 hook", () => {
  const merged = mergeTrackerHooks({}, COMMAND);
  for (const event of ["TaskCreated", "TaskCompleted"] as const) {
    const groups = merged.hooks?.[event];
    assert.ok(groups, `${event} 應該存在`);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, undefined);
    assert.deepEqual(groups[0].hooks, [{ type: "command", command: COMMAND, timeout: 5 }]);
  }
});

test("mergeTrackerHooks 保留無關 hook，並換掉 npx 快取裡的舊 task-tracker 路徑", () => {
  const stale =
    `"/usr/bin/node" "/Users/me/.npm/_npx/old/node_modules/claude-code-task-tracker/dist/hook/task-tracker-hook.js"`;
  const merged = mergeTrackerHooks(
    {
      theme: "light",
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "bash herdr.sh session", timeout: 10 }],
          },
        ],
        PreToolUse: [
          {
            matcher: "TodoWrite|TaskCreate",
            hooks: [{ type: "command", command: stale }],
          },
        ],
      },
    },
    COMMAND,
  );

  assert.equal(merged.theme, "light");
  const sessionStart = merged.hooks?.SessionStart ?? [];
  assert.equal(sessionStart.length, 2);
  assert.equal(sessionStart[0].hooks[0].command, "bash herdr.sh session");
  assert.equal(sessionStart[1].hooks[0].command, COMMAND);
  assert.equal((merged.hooks?.PreToolUse ?? []).length, 1);
  assert.equal(merged.hooks?.PreToolUse?.[0].matcher, "*");
  assert.equal(merged.hooks?.PreToolUse?.[0].hooks[0].command, COMMAND);
  assert.equal(
    JSON.stringify(merged).includes("/.npm/_npx/"),
    false,
    "舊 npx 路徑不該留下",
  );
});

test("mergeTrackerHooks 已是穩定路徑時不重複新增", () => {
  const once = mergeTrackerHooks({}, COMMAND);
  const twice = mergeTrackerHooks(once, COMMAND);
  assert.equal(twice.hooks?.PreToolUse?.length, 1);
  assert.equal(twice.hooks?.PostToolUse?.length, 1);
  assert.equal(twice.hooks?.SessionStart?.length, 1);
  assert.equal(twice.hooks?.TaskCreated?.length, 1);
  assert.equal(twice.hooks?.TaskCompleted?.length, 1);
});

test("writeSettingsFile 寫完只留下最終檔案，內容正確", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-settings-"));
  try {
    const settingsPath = join(dir, ".claude", "settings.json");
    writeSettingsFile(settingsPath, { theme: "light", hooks: { PreToolUse: [] } });

    const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(written, { theme: "light", hooks: { PreToolUse: [] } });

    const entries = readdirSync(join(dir, ".claude"));
    assert.deepEqual(entries, ["settings.json"], `不該留下 tmp 檔: ${entries.join(",")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSettingsFile 偵測合法 JSON 但形狀不對的 hooks，回友善錯誤而不是留給呼叫端丟例外", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-settings-schema-"));
  try {
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: { not: "an array" } } }));

    const result = readSettingsFile(settingsPath);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /手動檢查/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSettingsFile 形狀正確的既有設定仍正常讀入", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-settings-schema-ok-"));
  try {
    const settingsPath = join(dir, "settings.json");
    const settings = {
      theme: "dark",
      hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "x" }] }] },
    };
    writeFileSync(settingsPath, JSON.stringify(settings));

    const result = readSettingsFile(settingsPath);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.settings, settings);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSettingsFile 覆寫既有檔案時新內容完全取代舊內容，且結尾有換行", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-settings-overwrite-"));
  try {
    const settingsPath = join(dir, "settings.json");
    writeSettingsFile(settingsPath, { theme: "dark", hooks: { PreToolUse: [], PostToolUse: [], SessionStart: [] } });
    writeSettingsFile(settingsPath, { theme: "light" });

    const raw = readFileSync(settingsPath, "utf-8");
    assert.equal(raw, `${JSON.stringify({ theme: "light" }, null, 2)}\n`);
    assert.deepEqual(JSON.parse(raw), { theme: "light" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
