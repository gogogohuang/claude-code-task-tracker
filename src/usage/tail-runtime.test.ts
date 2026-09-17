import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, peek, peekSubagents, prime, refresh } from "./tail-runtime.js";

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
  try {
    const result = prime(sessionId, "/nonexistent/path/session.jsonl");
    assert.equal(result.stats.mainThreadMsgCount, 0);
    assert.deepEqual(result.advice, []);
  } finally {
    forget(sessionId);
  }
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

test("prime/refresh 對無法讀取的檔案（openSync/readSync 失敗）會 fail open，不拋錯", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-unreadable`;
  try {
    // 先寫一個有內容的檔案，讓 statSync 成功但 openSync 會失敗
    writeFileSync(path, assistantLine("m0", 60001) + "\n");
    // 移除讀取權限
    chmodSync(path, 0o000);
    // prime() 應該不拋錯，而是 fail open：返回空狀態
    const primed = prime(sessionId, path);
    assert.equal(primed.stats.mainThreadMsgCount, 0);
    assert.deepEqual(primed.advice, []);
    // 恢復權限以便清理
    chmodSync(path, 0o644);
  } finally {
    // 確保權限恢復以便清理
    try {
      chmodSync(path, 0o644);
    } catch {
      // 忽略，檔案可能已被刪除
    }
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

function fatToolResultLine(text: string): string {
  return JSON.stringify({
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_missing", content: text }],
    },
  });
}

test("refresh 讀取失敗時 offset 不會往前推進，恢復可讀之後能接續讀到暫存的內容，不會被永久跳過", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-readfail-offset`;
  try {
    writeFileSync(path, assistantLine("m0", 10) + "\n");
    prime(sessionId, path);

    // 附加一行大到會觸發 fat-tool-result 的 tool_result；readSync 失敗時這段內容還沒被消化。
    appendFileSync(path, fatToolResultLine("x".repeat(30001)) + "\n");

    chmodSync(path, 0o000);
    // openSync 應該會失敗，fail open 回傳空陣列；如果這時候 offset 被錯誤地推進到目前檔案大小
    // （用「想讀多少」而不是「實際讀到多少」去推進），下面恢復權限後就再也讀不到這段內容了。
    const failedRefresh = refresh(sessionId, path);
    assert.deepEqual(failedRefresh, []);

    chmodSync(path, 0o644);
    const recovered = refresh(sessionId, path);
    assert.equal(recovered.some((a) => a.kind === "fat-tool-result"), true);
  } finally {
    try {
      chmodSync(path, 0o644);
    } catch {
      // 忽略，檔案可能已被刪除
    }
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

function aiTitleLine(aiTitle: string): string {
  return JSON.stringify({ type: "ai-title", aiTitle });
}

function userLine(text: string): string {
  return JSON.stringify({
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text },
  });
}

function occupiedAssistantLine(id: string, input: number, cacheCreation: number, cacheRead: number): string {
  return JSON.stringify({
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      id,
      usage: {
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        output_tokens: 0,
        input_tokens: input,
      },
      content: [{ type: "text", text: "hi" }],
    },
  });
}

test("prime 後 peek 拿得到 title、firstPrompt、lastOccupiedTokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-peek`;
  try {
    writeFileSync(
      path,
      aiTitleLine("修用量面板") +
        "\n" +
        userLine("幫我修") +
        "\n" +
        occupiedAssistantLine("m0", 50, 100, 20) +
        "\n",
    );
    prime(sessionId, path);
    const stats = peek(sessionId);
    assert.equal(stats?.title, "修用量面板");
    assert.equal(stats?.firstPrompt, "幫我修");
    assert.equal(stats?.lastOccupiedTokens, 170);
    assert.equal(stats?.lastInput, 50);
    assert.equal(stats?.lastCacheCreation, 100);
    assert.equal(stats?.lastCacheRead, 20);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("peek 對沒 prime 過的 session 回 undefined", () => {
  assert.equal(peek("never-primed-session"), undefined);
});

function agentDispatchLine(toolUseId: string, subagentType: string): string {
  return JSON.stringify({
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      id: "m-agent",
      usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 0 },
      content: [{ type: "tool_use", id: toolUseId, name: "Agent", input: { subagent_type: subagentType } }],
    },
  });
}

test("prime 後 peekSubagents 拿得到派發清單", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-subagents`;
  try {
    writeFileSync(path, agentDispatchLine("toolu_1", "Explore") + "\n");
    prime(sessionId, path);
    const subagents = peekSubagents(sessionId);
    assert.equal(subagents?.dispatches.length, 1);
    assert.equal(subagents?.dispatches[0].subagentType, "Explore");
    assert.equal(subagents?.dispatches[0].status, "running");
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("peekSubagents 對沒 prime 過的 session 回 undefined", () => {
  assert.equal(peekSubagents("never-primed-session"), undefined);
});
