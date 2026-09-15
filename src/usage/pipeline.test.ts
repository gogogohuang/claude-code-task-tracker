import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, prime } from "./tail-runtime.js";
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
