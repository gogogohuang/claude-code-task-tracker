import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyHookEvent } from "./hook/apply-event.js";
import { HookPayloadSchema, TaskState } from "./schema.js";

const SAMPLES = readFileSync(new URL("./fixtures/codex-0.155.1-hook-samples.jsonl", import.meta.url), "utf-8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { event: string; payload: unknown });

test("重放 Codex 0.155.1 真實 payload：只處理已註冊事件，最終活動為 apply_patch 完成", () => {
  const previousLocale = process.env.TASK_TRACKER_LOCALE;
  process.env.TASK_TRACKER_LOCALE = "zh";
  try {
    const states = new Map<string, TaskState>();
    const writes: TaskState[] = [];
    const logs: string[] = [];
    const deps = {
      readTaskState: (id: string) => states.get(id) ?? null,
      writeTaskState: (s: TaskState) => { states.set(s.sessionId, s); writes.push(s); },
      appendDebugLog: (m: string) => { logs.push(m); },
      agent: "codex" as const,
    };
    for (const { payload } of SAMPLES) {
      const parsed = HookPayloadSchema.parse(payload);
      applyHookEvent(parsed, deps);
    }
    // UserPromptSubmit、Stop 不是 init 註冊的事件，不會寫狀態檔（沒有 tool_name，只記 debug log）
    const registered = SAMPLES.filter((s) => ["SessionStart", "PreToolUse", "PostToolUse"].includes(s.event));
    assert.equal(writes.length, registered.length);
    const final = writes.at(-1)!;
    assert.equal(final.agent, "codex");
    assert.equal(final.cwd, "/work/proj");
    assert.equal(final.claudeSessionDir, undefined);
    assert.equal(final.activity?.toolName, "apply_patch");
    assert.equal(final.activity?.phase, "done");
    assert.equal(final.activity?.summary, "已修改 a.txt");
    const shell = writes.find((s) => s.activity?.toolName === "Bash" && s.activity.phase === "running");
    assert.match(shell?.activity?.summary ?? "", /^正在執行 /);
  } finally {
    if (previousLocale === undefined) delete process.env.TASK_TRACKER_LOCALE;
    else process.env.TASK_TRACKER_LOCALE = previousLocale;
  }
});
