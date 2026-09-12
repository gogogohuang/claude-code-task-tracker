import assert from "node:assert/strict";
import test from "node:test";
import { matchExclude } from "./glob.js";

test("matchExclude 支援絕對路徑、雙星與單星", () => {
  assert.equal(
    matchExclude("**/monorepo/CLAUDE.md", "/home/user/monorepo/CLAUDE.md"),
    true,
  );
  assert.equal(
    matchExclude("/home/user/monorepo/other-team/.claude/rules/**", "/home/user/monorepo/other-team/.claude/rules/a.md"),
    true,
  );
  assert.equal(matchExclude("*.md", "/home/user/CLAUDE.md"), false);
  assert.equal(matchExclude("/home/user/*.md", "/home/user/CLAUDE.md"), true);
  assert.equal(matchExclude("/home/user/CLAUDE.md", "/home/user/CLAUDE.md"), true);
});
