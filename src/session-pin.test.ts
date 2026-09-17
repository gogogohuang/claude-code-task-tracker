import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPinOnLeave,
  pinnedTitleSuffix,
  shouldBlockAutoSelect,
  shouldBlockNewSessionFocus,
} from "./session-pin.js";

test("未釘選不阻擋", () => {
  assert.equal(shouldBlockAutoSelect(false), false);
  assert.equal(shouldBlockNewSessionFocus(false), false);
});

test("釘選阻擋 auto-select 與新 session 搶焦點", () => {
  assert.equal(shouldBlockAutoSelect(true), true);
  assert.equal(shouldBlockNewSessionFocus(true), true);
});

test("標題後綴", () => {
  assert.equal(pinnedTitleSuffix(false), "");
  assert.match(pinnedTitleSuffix(true), /已釘選/);
});

test("離開列表清除 pin", () => {
  assert.equal(clearPinOnLeave(), false);
});
