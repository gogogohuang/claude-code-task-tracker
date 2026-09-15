import assert from "node:assert/strict";
import test from "node:test";
import { HookPayloadSchema } from "./schema.js";

test("HookPayloadSchema 接受沒有 tool_name 的 SessionStart", () => {
  const parsed = HookPayloadSchema.parse({
    session_id: "abc",
    cwd: "/proj",
    hook_event_name: "SessionStart",
    source: "startup",
  });
  assert.equal(parsed.session_id, "abc");
  assert.equal(parsed.hook_event_name, "SessionStart");
  assert.equal(parsed.tool_name, undefined);
});

test("HookPayloadSchema 仍要求 session_id", () => {
  const result = HookPayloadSchema.safeParse({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
  });
  assert.equal(result.success, false);
});
