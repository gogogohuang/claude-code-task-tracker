import assert from "node:assert/strict";
import test from "node:test";
import { transcriptSource } from "./transcript-source.js";

const base = { sessionId: "s1", updatedAt: "2026-09-19T00:00:00.000Z" };

test("transcriptSource：沒有狀態或沒有路徑就回 undefined", () => {
  assert.equal(transcriptSource(null), undefined);
  assert.equal(transcriptSource(undefined), undefined);
  assert.equal(transcriptSource({ ...base }), undefined);
  assert.equal(transcriptSource({ ...base, agent: "codex" }), undefined);
});

test("transcriptSource：codex 用 transcriptPath", () => {
  assert.deepEqual(transcriptSource({ ...base, agent: "codex", transcriptPath: "/r/rollout.jsonl" }), {
    agent: "codex",
    path: "/r/rollout.jsonl",
  });
});

test("transcriptSource：claude 由 claudeSessionDir 推出 transcript 路徑", () => {
  const source = transcriptSource({ ...base, claudeSessionDir: "/nonexistent/proj" });
  assert.equal(source?.agent, "claude");
  assert.equal(source?.path, "/nonexistent/proj/s1.jsonl");
});
