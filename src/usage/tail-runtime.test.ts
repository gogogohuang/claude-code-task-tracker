import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, prime, refresh } from "./tail-runtime.js";

function assistantLine(id: string, cacheCreation: number): string {
  return JSON.stringify({
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      id,
      usage: { cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: 0, output_tokens: 0 },
      content: [{ type: "text", text: "hi" }],
    },
  });
}

test("prime + 連續 refresh 分批寫入的結果，累積統計正確且不重算已讀內容", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-a`;
  try {
    writeFileSync(path, assistantLine("m0", 60001) + "\n"); // 觸發 heavy-baseline
    const primed = prime(sessionId, path);
    assert.equal(primed.stats.mainThreadMsgCount, 1);
    assert.equal(primed.advice.some((a) => a.kind === "heavy-baseline"), true);

    appendFileSync(path, assistantLine("m1", 10) + "\n");
    const afterAppend = refresh(sessionId, path);
    assert.equal(afterAppend.length, 0);

    const noNewContent = refresh(sessionId, path);
    assert.deepEqual(noNewContent, []);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh 對還沒 prime 過的 session 會自動先 prime", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-b`;
  try {
    writeFileSync(path, assistantLine("m0", 100) + "\n");
    const advice = refresh(sessionId, path);
    assert.equal(Array.isArray(advice), true);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prime 對不存在的檔案回傳空狀態，不拋錯", () => {
  const sessionId = `test-missing-${Date.now()}`;
  const result = prime(sessionId, "/nonexistent/path/session.jsonl");
  assert.equal(result.stats.mainThreadMsgCount, 0);
  assert.deepEqual(result.advice, []);
  forget(sessionId);
});

test("forget 之後同一個 sessionId 的下一次 refresh 等同重新 prime", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-c`;
  try {
    writeFileSync(path, assistantLine("m0", 60001) + "\n");
    prime(sessionId, path);
    forget(sessionId);
    const advice = refresh(sessionId, path); // 內部沒有紀錄了，等同從頭 prime
    assert.equal(advice.some((a) => a.kind === "heavy-baseline"), true);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});
