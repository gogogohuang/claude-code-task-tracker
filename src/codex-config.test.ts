import assert from "node:assert/strict";
import test from "node:test";
import { codexHooksDisabled } from "./codex-config.js";

test("[features] 內 hooks = false 視為關閉", () => {
  assert.equal(codexHooksDisabled("[features]\njs_repl = false\nhooks = false\n"), true);
  assert.equal(codexHooksDisabled("[features]\n  hooks   =   false  # off\n"), true);
});

test("hooks = true、沒寫、或 false 出現在別的區段都不算關閉", () => {
  assert.equal(codexHooksDisabled("[features]\nhooks = true\n"), false);
  assert.equal(codexHooksDisabled("[features]\njs_repl = false\n"), false);
  assert.equal(codexHooksDisabled("[mcp_servers.x]\nhooks = false\n"), false);
  assert.equal(codexHooksDisabled(""), false);
});
