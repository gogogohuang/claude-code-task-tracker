import assert from "node:assert/strict";
import test from "node:test";
import { previewDisplayLines, previewLineCount } from "./preview-display.js";

test("previewDisplayLines 沒有文字時用 notice", () => {
  assert.deepEqual(previewDisplayLines({ notice: "未找到" }), ["未找到"]);
  assert.deepEqual(previewDisplayLines({}), [""]);
});

test("previewDisplayLines 在載入邊界插入分隔線", () => {
  assert.deepEqual(
    previewDisplayLines({ text: "a\nb\nc", loadBoundaryLine: 2 }),
    ["a", "b", "──── 啟動時不載入 ────", "c"],
  );
});

test("previewLineCount 含分隔線那一行", () => {
  assert.equal(previewLineCount({ text: "a\nb" }), 2);
  assert.equal(previewLineCount({ text: "a\nb", loadBoundaryLine: 1 }), 3);
  assert.equal(previewLineCount({ notice: "x" }), 1);
});
