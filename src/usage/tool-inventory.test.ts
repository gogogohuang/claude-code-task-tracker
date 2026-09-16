import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyToolInventory,
  formatToolInventoryLines,
  formatToolInventorySummary,
  parseMcpToolName,
  recordToolUse,
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
