import assert from "node:assert/strict";
import test from "node:test";
import { clampScrollOffset, scrollOffsetForSelection, visibleSlice } from "./scroll-window.js";

test("clampScrollOffset 不超出清單範圍", () => {
  assert.equal(clampScrollOffset(-2, 10, 4), 0);
  assert.equal(clampScrollOffset(3, 10, 4), 3);
  assert.equal(clampScrollOffset(9, 10, 4), 6);
  assert.equal(clampScrollOffset(0, 3, 8), 0);
});

test("visibleSlice 只回傳當頁列", () => {
  const items = ["a", "b", "c", "d", "e"];
  assert.deepEqual(visibleSlice(items, 0, 3), ["a", "b", "c"]);
  assert.deepEqual(visibleSlice(items, 2, 3), ["c", "d", "e"]);
  assert.deepEqual(visibleSlice(items, 99, 3), ["c", "d", "e"]);
});

test("scrollOffsetForSelection 選中列在視窗外時帶著捲動", () => {
  assert.equal(scrollOffsetForSelection(1, 0, 3), 0);
  assert.equal(scrollOffsetForSelection(0, 2, 3), 0);
  assert.equal(scrollOffsetForSelection(5, 0, 3), 3);
  assert.equal(scrollOffsetForSelection(4, 2, 3), 2);
});
