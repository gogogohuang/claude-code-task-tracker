import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, peek, prime, refresh } from "./tail-runtime.js";
import { adviceForSession } from "./advice-groups.js";

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

test("prime() 產生的 advice 接上 adviceForSession，只留下該 session", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-pipeline-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `pipeline-${Date.now()}`;
  try {
    writeFileSync(path, assistantLine("m0", 60001) + "\n"); // 觸發 heavy-baseline advice
    const primed = prime(sessionId, path);
    assert.equal(primed.advice.length > 0, true);

    const filtered = adviceForSession(primed.advice, sessionId);
    assert.equal(filtered.length, primed.advice.length);
    assert.equal(filtered.every((item) => item.sessionId === sessionId), true);
    assert.equal(filtered.some((item) => item.kind === "heavy-baseline"), true);
    assert.deepEqual(adviceForSession(primed.advice, undefined), []);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

function codexTokenLine(total: number, input: number, cached: number): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 1 },
        model_context_window: 258400,
      },
    },
  });
}

test("Codex：prime／refresh 用 Codex 解析器，advice 為 Codex 文案，統計帶視窗", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-codex-"));
  const path = join(dir, "rollout.jsonl");
  const sessionId = `codex-pipeline-${Date.now()}`;
  try {
    writeFileSync(path, codexTokenLine(60001, 60001, 0) + "\n"); // 第一輪 60001 個沒命中 → heavy-baseline
    const primed = prime(sessionId, path, "codex");
    const heavy = primed.advice.filter((a) => a.kind === "heavy-baseline");
    assert.equal(heavy.length, 1);
    assert.match(heavy[0].message, /開場偏重/);
    assert.doesNotMatch(heavy[0].message, /inspect/);
    assert.equal(peek(sessionId)?.lastContextWindow, 258400);
    assert.equal(peek(sessionId)?.lastOccupiedTokens, 60001);

    writeFileSync(path, codexTokenLine(60001, 60001, 0) + "\n" + codexTokenLine(80000, 20000, 19000) + "\n");
    refresh(sessionId, path, "codex");
    assert.equal(peek(sessionId)?.mainThreadMsgCount, 2);
    assert.equal(peek(sessionId)?.lastOccupiedTokens, 20000);
    assert.equal(peek(sessionId)?.lastCacheRead, 19000);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});
