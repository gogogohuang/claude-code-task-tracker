import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InspectEntry } from "./types.js";
import { memoryLoadBoundaryLine, readPreview } from "./preview.js";

function entry(overrides: Partial<InspectEntry> & Pick<InspectEntry, "absolutePath">): InspectEntry {
  return {
    id: "id",
    section: "launch",
    label: "label",
    status: "present",
    ...overrides,
  };
}

test("memoryLoadBoundaryLine 取 200 行與 25KB 的較早者", () => {
  assert.equal(memoryLoadBoundaryLine("one\ntwo\n"), undefined);
  const lines = Array.from({ length: 201 }, (_, index) => `line ${index}`).join("\n");
  assert.equal(memoryLoadBoundaryLine(lines), 200);
  const wide = `${"x".repeat(25 * 1024 + 10)}\n`;
  assert.equal(memoryLoadBoundaryLine(wide), 0);
});

test("readPreview 對未載入狀態只給提示，present 則回原文", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-preview-"));
  const file = join(dir, "CLAUDE.md");
  writeFileSync(file, "hello\n");
  assert.equal(readPreview(entry({ absolutePath: file })).text, "hello\n");
  assert.equal(readPreview(entry({ absolutePath: file, status: "missing" })).notice, "未找到");
  assert.equal(
    readPreview(entry({ absolutePath: file, section: "onDemand" })).notice,
    "按需載入，不預覽內容",
  );
});
