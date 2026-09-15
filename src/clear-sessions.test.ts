import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSessions } from "./clear-sessions.js";

function writeSession(dir: string, sessionId: string, cwd?: string) {
  writeFileSync(
    join(dir, `${sessionId}.json`),
    JSON.stringify({ sessionId, cwd, updatedAt: "2026-09-15T00:00:00.000Z" }),
  );
}

test("clearSessions 預設只刪 cwd 對得上的 session json", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-clear-"));
  try {
    writeSession(dir, "keep-other", "/proj/b");
    writeSession(dir, "drop-here", "/proj/a");
    writeSession(dir, "no-cwd");
    writeFileSync(join(dir, "task-tracker-hook.js"), "hook");
    writeFileSync(join(dir, "hook-debug.log"), "log");

    const result = clearSessions({ stateDir: dir, cwd: "/proj/a" });
    assert.deepEqual(result.deletedSessionIds, ["drop-here"]);
    assert.equal(result.logDeleted, false);
    assert.equal(existsSync(join(dir, "drop-here.json")), false);
    assert.equal(existsSync(join(dir, "keep-other.json")), true);
    assert.equal(existsSync(join(dir, "no-cwd.json")), true);
    assert.equal(existsSync(join(dir, "task-tracker-hook.js")), true);
    assert.equal(existsSync(join(dir, "hook-debug.log")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearSessions --all 刪全部 session json，仍保留 hook", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-clear-"));
  try {
    writeSession(dir, "a", "/proj/a");
    writeSession(dir, "b", "/proj/b");
    writeFileSync(join(dir, "task-tracker-hook.js"), "hook");

    const result = clearSessions({ stateDir: dir, cwd: "/proj/a", all: true });
    assert.deepEqual(result.deletedSessionIds.sort(), ["a", "b"]);
    assert.equal(existsSync(join(dir, "a.json")), false);
    assert.equal(existsSync(join(dir, "b.json")), false);
    assert.equal(existsSync(join(dir, "task-tracker-hook.js")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearSessions --log 才刪 hook-debug.log", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-clear-"));
  try {
    writeFileSync(join(dir, "hook-debug.log"), "log");
    const without = clearSessions({ stateDir: dir, cwd: "/proj/a" });
    assert.equal(without.logDeleted, false);
    assert.equal(existsSync(join(dir, "hook-debug.log")), true);

    const withLog = clearSessions({ stateDir: dir, cwd: "/proj/a", clearLog: true });
    assert.equal(withLog.logDeleted, true);
    assert.equal(existsSync(join(dir, "hook-debug.log")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearSessions 目錄不存在時回空結果", () => {
  const result = clearSessions({ stateDir: join(tmpdir(), "tt-clear-missing-" + Date.now()), cwd: "/proj/a" });
  assert.deepEqual(result.deletedSessionIds, []);
  assert.equal(result.logDeleted, false);
});
