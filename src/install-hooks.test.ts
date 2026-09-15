import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHookCommand,
  isTrackerHookCommand,
  mergeTrackerHooks,
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
