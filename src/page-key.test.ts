import assert from "node:assert/strict";
import test from "node:test";
import { pageKeyOf, type PageIdentity } from "./page-key.js";

const base: PageIdentity = {
  view: "main",
  activeAgent: "claude",
  selectedSessionId: "s1",
  projectKey: undefined,
  pickingSplitPartner: false,
};

test("pageKeyOf 同一頁 key 不變", () => {
  assert.equal(pageKeyOf(base), pageKeyOf({ ...base }));
});

test("pageKeyOf 任何一個維度改變就換 key", () => {
  const changed: PageIdentity[] = [
    { ...base, view: "advice" },
    { ...base, activeAgent: "codex" },
    { ...base, selectedSessionId: "s2" },
    { ...base, selectedSessionId: undefined },
    { ...base, projectKey: "/repo" },
    { ...base, pickingSplitPartner: true },
  ];
  const keys = new Set([pageKeyOf(base), ...changed.map(pageKeyOf)]);
  assert.equal(keys.size, changed.length + 1);
});

test("pageKeyOf 不會因欄位值含分隔字元而撞 key", () => {
  assert.notEqual(
    pageKeyOf({ ...base, selectedSessionId: "a|b", projectKey: "c" }),
    pageKeyOf({ ...base, selectedSessionId: "a", projectKey: "b|c" }),
  );
});
