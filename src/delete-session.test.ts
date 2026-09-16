import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DELETE_SESSION_CONFIRM_NOTICE,
  DELETE_SESSION_RUNNING_NOTICE,
  armOrConfirmDelete,
  deleteSessionState,
  isSessionBusy,
  shouldHandleDeleteKey,
} from "./delete-session.js";

test("shouldHandleDeleteKey 只在 main 且已選 session 時為 true", () => {
  assert.equal(shouldHandleDeleteKey("main", "s1"), true);
  assert.equal(shouldHandleDeleteKey("advice", "s1"), false);
  assert.equal(shouldHandleDeleteKey("purge", "s1"), false);
  assert.equal(shouldHandleDeleteKey("main", undefined), false);
});

test("armOrConfirmDelete 第一次 arm，同一 session 第二次 confirm", () => {
  assert.equal(armOrConfirmDelete(undefined, "s1"), "arm");
  assert.equal(armOrConfirmDelete("s1", "s1"), "confirm");
  assert.equal(armOrConfirmDelete("other", "s1"), "arm");
});

test("DELETE_SESSION_CONFIRM_NOTICE 文案固定", () => {
  assert.equal(DELETE_SESSION_CONFIRM_NOTICE, "再按 d 刪除這個 session（按 b 取消）");
});

test("isSessionBusy 只在 activity.phase 為 running 時為 true", () => {
  assert.equal(isSessionBusy({ phase: "running" }), true);
  assert.equal(isSessionBusy({ phase: "done" }), false);
  assert.equal(isSessionBusy(undefined), false);
  assert.equal(isSessionBusy(null), false);
});

test("DELETE_SESSION_RUNNING_NOTICE 文案固定", () => {
  assert.equal(DELETE_SESSION_RUNNING_NOTICE, "這個 session 正在執行中，無法刪除");
});

test("deleteSessionState 刪掉指定 json，不存在則回 false", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-del-"));
  try {
    writeFileSync(join(dir, "s1.json"), "{}");
    writeFileSync(join(dir, "keep.json"), "{}");
    assert.equal(deleteSessionState("s1", dir), true);
    assert.equal(existsSync(join(dir, "s1.json")), false);
    assert.equal(existsSync(join(dir, "keep.json")), true);
    assert.equal(deleteSessionState("missing", dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
