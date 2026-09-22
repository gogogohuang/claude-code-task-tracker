import assert from "node:assert/strict";
import test from "node:test";
import { canSwitchTab, formatTabLabel, nextTabAgent, summarizeTabs } from "./agent-tabs.js";

const now = Date.parse("2026-09-19T02:00:00.000Z");
const at = "2026-09-19T01:59:55.000Z";

test("nextTabAgent 循環切換，支援反向", () => {
  assert.equal(nextTabAgent("claude"), "codex");
  assert.equal(nextTabAgent("codex"), "cursor");
  assert.equal(nextTabAgent("cursor"), "claude");
  assert.equal(nextTabAgent("claude", -1), "cursor");
  assert.equal(nextTabAgent("codex", -1), "claude");
});

test("summarizeTabs 依來源計數，等待使用者的 session 標記為 attention，cursor 不支援", () => {
  const tabs = summarizeTabs(
    [
      { sessionId: "a", cwd: "/p", updatedAt: at },
      { sessionId: "b", cwd: "/p", updatedAt: at, agent: "codex", activityToolName: "AskUserQuestion", activityPhase: "running" },
      { sessionId: "c", cwd: "/p", updatedAt: at, agent: "codex" },
    ],
    now,
  );
  assert.deepEqual(tabs.map((t) => [t.agent, t.count, t.attention, t.supported]), [
    ["claude", 1, false, true],
    ["codex", 2, true, true],
    ["cursor", 0, false, false],
  ]);
});

test("formatTabLabel：不支援的顯示 –，待處理加 !", () => {
  assert.equal(formatTabLabel({ agent: "claude", label: "Claude", count: 3, attention: false, supported: true }), "Claude 3");
  assert.equal(formatTabLabel({ agent: "codex", label: "Codex", count: 2, attention: true, supported: true }), "Codex 2 !");
  assert.equal(formatTabLabel({ agent: "cursor", label: "Cursor", count: 0, attention: false, supported: false }), "Cursor –");
});

test("canSwitchTab 只在列表畫面（未選定 session、main、非挑選 split 夥伴）生效", () => {
  assert.equal(canSwitchTab({ view: "main", hasSelectedSession: false, pickingSplitPartner: false }), true);
  assert.equal(canSwitchTab({ view: "main", hasSelectedSession: true, pickingSplitPartner: false }), false);
  assert.equal(canSwitchTab({ view: "main", hasSelectedSession: false, pickingSplitPartner: true }), false);
  assert.equal(canSwitchTab({ view: "split", hasSelectedSession: false, pickingSplitPartner: false }), false);
});
