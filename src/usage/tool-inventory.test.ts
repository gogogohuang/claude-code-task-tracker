import assert from "node:assert/strict";
import test from "node:test";
import {
  appendToolCallLog,
  detailToolLabel,
  emptyToolInventory,
  formatToolInventoryLines,
  formatToolInventorySummary,
  parseMcpToolName,
  recordToolUse,
  TOOL_CALL_LOG_LIMIT,
  type ToolCallLogEntry,
} from "./tool-inventory.js";

test("parseMcpToolName 拆出 server 與 tool", () => {
  assert.deepEqual(parseMcpToolName("mcp__playwright__browser_click"), {
    server: "playwright",
    tool: "browser_click",
  });
  assert.deepEqual(parseMcpToolName("mcp__github__list_issues"), {
    server: "github",
    tool: "list_issues",
  });
});

test("parseMcpToolName 非 mcp 或格式不完整回 undefined", () => {
  assert.equal(parseMcpToolName("Read"), undefined);
  assert.equal(parseMcpToolName("mcp__"), undefined);
  assert.equal(parseMcpToolName("mcp__onlyserver"), undefined);
  assert.equal(parseMcpToolName("mcp____tool"), undefined);
});

test("recordToolUse 累加一般 tool 與 mcp 次數", () => {
  let inv = emptyToolInventory();
  inv = recordToolUse(inv, "Read");
  inv = recordToolUse(inv, "Read");
  inv = recordToolUse(inv, "Bash");
  inv = recordToolUse(inv, "mcp__playwright__browser_click");
  inv = recordToolUse(inv, "mcp__playwright__browser_navigate");
  inv = recordToolUse(inv, "mcp__github__list_issues");

  assert.deepEqual(inv.tools, { Read: 2, Bash: 1 });
  assert.deepEqual(inv.mcpTools, {
    "playwright/browser_click": 1,
    "playwright/browser_navigate": 1,
    "github/list_issues": 1,
  });
});

test("formatToolInventorySummary 顯示 unique tools 與 unique mcp servers", () => {
  let inv = emptyToolInventory();
  inv = recordToolUse(inv, "Read");
  inv = recordToolUse(inv, "Bash");
  inv = recordToolUse(inv, "mcp__playwright__browser_click");
  inv = recordToolUse(inv, "mcp__playwright__browser_navigate");
  inv = recordToolUse(inv, "mcp__github__list_issues");

  assert.equal(formatToolInventorySummary(inv), "tools 2 · mcp 2");
});

test("formatToolInventorySummary 全空回 undefined；只有一邊就只顯示那邊", () => {
  assert.equal(formatToolInventorySummary(emptyToolInventory()), undefined);
  assert.equal(formatToolInventorySummary(recordToolUse(emptyToolInventory(), "Read")), "tools 1");
  assert.equal(
    formatToolInventorySummary(recordToolUse(emptyToolInventory(), "mcp__playwright__browser_click")),
    "mcp 1",
  );
});

test("formatToolInventoryLines 分兩區並依次數由高到低", () => {
  let inv = emptyToolInventory();
  inv = recordToolUse(inv, "Bash");
  inv = recordToolUse(inv, "Read");
  inv = recordToolUse(inv, "Read");
  inv = recordToolUse(inv, "mcp__playwright__browser_click");
  inv = recordToolUse(inv, "mcp__playwright__browser_click");
  inv = recordToolUse(inv, "mcp__github__list_issues");

  assert.deepEqual(formatToolInventoryLines(inv), [
    "工具",
    "  Read × 2",
    "  Bash × 1",
    "MCP",
    "  playwright / browser_click × 2",
    "  github / list_issues × 1",
  ]);
});

test("detailToolLabel Skill 用 skill／skillName，Agent 用 subagent_type", () => {
  assert.equal(
    detailToolLabel("Skill", { skill: "superpowers:writing-plans" }),
    "Skill · superpowers:writing-plans",
  );
  assert.equal(detailToolLabel("Skill", { skillName: "commit" }), "Skill · commit");
  assert.equal(detailToolLabel("Agent", { subagent_type: "Explore" }), "Agent · Explore");
});

test("appendToolCallLog 依序 append", () => {
  let log: ToolCallLogEntry[] = [];
  log = appendToolCallLog(log, { at: "t1", toolName: "Read", path: "a.ts" });
  log = appendToolCallLog(log, { at: "t2", toolName: "Bash" });
  assert.deepEqual(log, [
    { at: "t1", toolName: "Read", path: "a.ts" },
    { at: "t2", toolName: "Bash" },
  ]);
});

test("appendToolCallLog 超過上限丟最舊、留最近呼叫", () => {
  let log: ToolCallLogEntry[] = [];
  for (let i = 0; i < TOOL_CALL_LOG_LIMIT + 5; i++) {
    log = appendToolCallLog(log, { at: `t${i}`, toolName: `T${i}` });
  }
  assert.equal(log.length, TOOL_CALL_LOG_LIMIT);
  assert.equal(log[0]?.toolName, "T5");
  assert.equal(log.at(-1)?.toolName, `T${TOOL_CALL_LOG_LIMIT + 4}`);
});

test("detailToolLabel 抽不到細節或非 Skill／Agent 時回工具本名", () => {
  assert.equal(detailToolLabel("Skill", {}), "Skill");
  assert.equal(detailToolLabel("Skill", null), "Skill");
  assert.equal(detailToolLabel("Read", { file_path: "a.ts" }), "Read");
  assert.equal(detailToolLabel("mcp__playwright__browser_click", {}), "mcp__playwright__browser_click");
});
