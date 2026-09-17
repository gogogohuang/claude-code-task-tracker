import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_SPLIT_COLUMNS,
  SPLIT_TOO_NARROW_NOTICE,
  canEnterSplit,
  canPickSplitPartner,
  focusedSessionId,
  otherFocus,
} from "./split-layout.js";

test("canEnterSplit：寬度門檻", () => {
  assert.equal(canEnterSplit(MIN_SPLIT_COLUMNS - 1), false);
  assert.equal(canEnterSplit(MIN_SPLIT_COLUMNS), true);
  assert.equal(canEnterSplit(200), true);
});

test("otherFocus 左右互換", () => {
  assert.equal(otherFocus("left"), "right");
  assert.equal(otherFocus("right"), "left");
});

test("focusedSessionId", () => {
  assert.equal(focusedSessionId("a", "b", "left"), "a");
  assert.equal(focusedSessionId("a", "b", "right"), "b");
});

test("canPickSplitPartner 不可與左欄相同", () => {
  assert.equal(canPickSplitPartner("b", "a"), true);
  assert.equal(canPickSplitPartner("a", "a"), false);
});

test("過窄 notice 含門檻數字", () => {
  assert.match(SPLIT_TOO_NARROW_NOTICE, new RegExp(String(MIN_SPLIT_COLUMNS)));
});
