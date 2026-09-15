import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHint } from "../session-preference.js";
import { forget, prime } from "./tail-runtime.js";
import { groupAdviceByProject } from "./advice-groups.js";

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

// 這是整條「prime() 讀 transcript → groupAdviceByProject 組成面板列」的組合測試，
// 補上目前沒人測的一段：單元測試各自涵蓋 prime 跟 groupAdviceByProject，但沒人斷言
// 兩者接起來之後，AdvicePanel 實際拿到的那一列資料形狀是對的。
test("prime() 產生的 advice 接上 groupAdviceByProject，能組成正確的面板列資料", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-pipeline-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `pipeline-${Date.now()}`;
  try {
    writeFileSync(path, assistantLine("m0", 60001) + "\n"); // 觸發 heavy-baseline advice
    const primed = prime(sessionId, path);
    assert.equal(primed.advice.length > 0, true);

    const hint: SessionHint = {
      sessionId,
      cwd: "/proj/pipeline",
      updatedAt: new Date().toISOString(),
      activitySummary: "測試中",
    };
    const groups = groupAdviceByProject(primed.advice, [hint], "/proj/pipeline");

    assert.equal(groups.length, 1);
    assert.equal(groups[0].sessions.length, 1);
    const session = groups[0].sessions[0];
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.isCurrent, true);
    assert.equal(session.activitySummary, "測試中");
    assert.equal(session.advice.length, primed.advice.length);
    assert.equal(session.advice.some((a) => a.kind === "heavy-baseline"), true);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});
