import assert from "node:assert/strict";
import test from "node:test";
import { formatRelativeAge } from "./format-relative-age.js";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

test("formatRelativeAge 未滿 1 分鐘顯示剛剛", () => {
  assert.equal(formatRelativeAge("2026-09-15T11:59:30.000Z", NOW), "剛剛");
});

test("formatRelativeAge 未滿 60 分鐘顯示 N 分鐘前", () => {
  assert.equal(formatRelativeAge("2026-09-15T11:57:00.000Z", NOW), "3 分鐘前");
});

test("formatRelativeAge 滿 60 分鐘改顯示 N 小時前", () => {
  assert.equal(formatRelativeAge("2026-09-15T11:00:00.000Z", NOW), "1 小時前");
});

test("formatRelativeAge 滿 24 小時改顯示 N 天前", () => {
  assert.equal(formatRelativeAge("2026-09-14T12:00:00.000Z", NOW), "1 天前");
});

test("formatRelativeAge 無效時間回空字串", () => {
  assert.equal(formatRelativeAge("not-a-date", NOW), "");
});
