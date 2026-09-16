import assert from "node:assert/strict";
import test from "node:test";
import { cachePanelLines } from "./cache-panel-lines.js";

test("cachePanelLines 含路徑與 pretty JSON", () => {
  const lines = cachePanelLines({
    filePath: "/tmp/s1.json",
    state: { sessionId: "s1", updatedAt: "2026-01-01T00:00:00.000Z" },
  });
  assert.equal(lines[0], "# /tmp/s1.json");
  assert.match(lines.join("\n"), /"sessionId": "s1"/);
});

test("cachePanelLines 解析失敗時用 raw", () => {
  const lines = cachePanelLines({
    filePath: "/tmp/bad.json",
    state: null,
    rawFallback: '{"broken":',
  });
  assert.match(lines.join("\n"), /broken/);
  assert.match(lines.join("\n"), /原始內容/);
});
