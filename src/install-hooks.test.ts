import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHookCommand,
  hasTrackerHookInstalled,
  installTrackerHooks,
  isTrackerHookCommand,
  mergeTrackerHooks,
  readSettingsFile,
  settingsPathFor,
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

test("hasTrackerHookInstalled 偵測到指定 scope 已安裝 tracker hook", () => {
  const cwd = mkdtempSync(join(tmpdir(), "tt-scope-"));
  try {
    const settingsPath = settingsPathFor("project", { home: "/unused", cwd });
    writeSettingsFile(settingsPath, mergeTrackerHooks({}, COMMAND));
    assert.equal(hasTrackerHookInstalled("project", { home: "/unused", cwd }), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("hasTrackerHookInstalled 沒裝過或檔案不存在回 false", () => {
  const cwd = mkdtempSync(join(tmpdir(), "tt-scope-none-"));
  try {
    assert.equal(hasTrackerHookInstalled("project", { home: "/unused", cwd }), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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

const CODEX_COMMAND = buildHookCommand("/usr/bin/node", "/home/me/.claude-task-tracker/task-tracker-hook.js", "codex");

test("buildHookCommand：claude 不變，codex 追加 --agent codex", () => {
  assert.equal(COMMAND.includes("--agent"), false);
  assert.equal(CODEX_COMMAND, `${COMMAND} --agent codex`);
  assert.equal(isTrackerHookCommand(CODEX_COMMAND), true);
});

test("settingsPathFor：codex 指向 ~/.codex/hooks.json 與 <cwd>/.codex/hooks.json", () => {
  const input = { home: "/h", cwd: "/p" };
  assert.equal(settingsPathFor("user", input, "codex"), join("/h", ".codex", "hooks.json"));
  assert.equal(settingsPathFor("project", input, "codex"), join("/p", ".codex", "hooks.json"));
  assert.equal(settingsPathFor("user", input), join("/h", ".claude", "settings.json"));
});

test("mergeTrackerHooks codex：只註冊 SessionStart／PreToolUse／PostToolUse，且不設 matcher", () => {
  const merged = mergeTrackerHooks({}, CODEX_COMMAND, "codex");
  assert.deepEqual(Object.keys(merged.hooks ?? {}).sort(), ["PostToolUse", "PreToolUse", "SessionStart"]);
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart"] as const) {
    const groups = merged.hooks?.[event];
    assert.equal(groups?.length, 1);
    assert.equal(groups?.[0].matcher, undefined);
    assert.deepEqual(groups?.[0].hooks, [{ type: "command", command: CODEX_COMMAND, timeout: 5 }]);
  }
});

test("mergeTrackerHooks codex：保留 TempoTerm、herdr 等既有 hook，重跑冪等", () => {
  const existing = {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: '"/Applications/TempoTerm.app/Contents/MacOS/tempo-term" --status-hook codex active' }] },
      ],
      SessionStart: [
        { hooks: [{ type: "command", command: "bash '/Users/me/.codex/herdr-agent-state.sh' session", timeout: 10 }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "tempo stop" }] }],
    },
  };
  const once = mergeTrackerHooks(existing, CODEX_COMMAND, "codex");
  const twice = mergeTrackerHooks(once, CODEX_COMMAND, "codex");
  assert.deepEqual(twice, once);
  assert.equal(once.hooks?.PreToolUse?.length, 2);
  assert.equal(once.hooks?.SessionStart?.length, 2);
  assert.deepEqual(once.hooks?.Stop, existing.hooks.Stop);
  assert.equal(once.hooks?.PreToolUse?.[0].hooks[0].command.includes("tempo-term"), true);
});

test("installTrackerHooks codex：寫入 ~/.codex/hooks.json，第二次回 already", () => {
  const root = mkdtempSync(join(tmpdir(), "tt-codex-"));
  try {
    const home = join(root, "home");
    const bundled = join(root, "bundled-hook.js");
    writeFileSync(bundled, "// hook");
    const input = {
      scope: "user" as const, home, cwd: root, execPath: "/usr/bin/node",
      bundledHookPath: bundled, stateDir: join(root, "state"), agent: "codex" as const,
    };
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "tempo stop" }] }] } }),
    );
    const first = installTrackerHooks(input);
    assert.deepEqual(first, { ok: true, settingsPath: join(home, ".codex", "hooks.json"), already: false });
    const written = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8"));
    assert.equal(written.hooks.Stop[0].hooks[0].command, "tempo stop");
    assert.equal(written.hooks.PreToolUse[0].hooks[0].command.endsWith("--agent codex"), true);
    const second = installTrackerHooks(input);
    assert.equal(second.ok && second.already, true);
    assert.equal(hasTrackerHookInstalled("user", { home, cwd: root }, "codex"), true);
    assert.equal(hasTrackerHookInstalled("user", { home, cwd: root }, "claude"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
