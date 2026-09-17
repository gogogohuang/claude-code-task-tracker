import assert from "node:assert/strict";
import test from "node:test";
import { extractImports, readRulePaths } from "./markdown.js";

test("extractImports 略過 code span 與 fence，並相對來源檔解析", () => {
  const markdown = [
    "See @README and @docs/guide.md.",
    "Mail user@example.com stays literal.",
    "Keep `@README` and `@docs/secret.md` literal.",
    "```",
    "@docs/not-this.md",
    "```",
    "@~/notes.md",
    "",
  ].join("\n");

  const imports = extractImports(markdown, "/proj/CLAUDE.md", "/Users/me");
  assert.deepEqual(
    imports.map((item) => item.resolvedPath),
    ["/proj/README", "/proj/docs/guide.md", "/Users/me/notes.md"],
  );
});

test("readRulePaths 沒有 paths 回 null，有 paths 就回條件", () => {
  assert.equal(readRulePaths("# just a rule\n"), null);
  assert.deepEqual(
    readRulePaths("---\npaths:\n  - src/**/*.ts\n  - \"lib/**/*.ts\"\n---\n# Rule\n"),
    ["src/**/*.ts", "lib/**/*.ts"],
  );
  assert.deepEqual(readRulePaths("---\npaths: src/api/**/*.ts\n---\n"), ["src/api/**/*.ts"]);
});

test("readRulePaths 認得 CRLF 換行的 frontmatter", () => {
  assert.deepEqual(
    readRulePaths("---\r\npaths:\r\n  - src/**/*.ts\r\n  - \"lib/**/*.ts\"\r\n---\r\n# Rule\r\n"),
    ["src/**/*.ts", "lib/**/*.ts"],
  );
  assert.deepEqual(readRulePaths("---\r\npaths: src/api/**/*.ts\r\n---\r\n"), ["src/api/**/*.ts"]);
});
