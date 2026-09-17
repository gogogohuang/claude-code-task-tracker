import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocale } from "./locale.js";

test("TASK_TRACKER_LOCALE 優先", () => {
  assert.equal(resolveLocale({ TASK_TRACKER_LOCALE: "en", LANG: "zh_TW.UTF-8" }), "en");
  assert.equal(resolveLocale({ TASK_TRACKER_LOCALE: "ZH", LANG: "en_US" }), "zh");
});

test("無覆寫時從 LANG／LC_ALL 推斷", () => {
  assert.equal(resolveLocale({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(resolveLocale({ LANG: "EN" }), "en");
  assert.equal(resolveLocale({ LC_ALL: "en_GB.UTF-8" }), "en");
  assert.equal(resolveLocale({ LANG: "zh_TW.UTF-8" }), "zh");
  assert.equal(resolveLocale({}), "zh");
});

test("無效 TASK_TRACKER_LOCALE 忽略並回退", () => {
  assert.equal(resolveLocale({ TASK_TRACKER_LOCALE: "fr", LANG: "en_US" }), "en");
  assert.equal(resolveLocale({ TASK_TRACKER_LOCALE: "fr" }), "zh");
});
