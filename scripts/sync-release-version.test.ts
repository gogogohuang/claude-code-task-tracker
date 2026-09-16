import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReleaseVersion,
  parseReleaseTag,
} from "./sync-release-version.js";

test("parseReleaseTag 去掉可選的 v 前綴", () => {
  assert.equal(parseReleaseTag("v0.17.0"), "0.17.0");
  assert.equal(parseReleaseTag("0.14.1"), "0.14.1");
});

test("parseReleaseTag 拒絕非法 tag", () => {
  assert.throws(() => parseReleaseTag(""), /invalid release tag/i);
  assert.throws(() => parseReleaseTag("v0.17"), /invalid release tag/i);
  assert.throws(() => parseReleaseTag("v0.17.0-beta"), /invalid release tag/i);
  assert.throws(() => parseReleaseTag("release-0.17.0"), /invalid release tag/i);
});

const samplePkg = `{
  "name": "claude-code-task-tracker",
  "version": "0.14.1",
  "license": "MIT"
}
`;

const sampleReadme = `# claude-code-task-tracker

目前版本：**v0.14.1**。套件頁：[npm](https://www.npmjs.com/package/claude-code-task-tracker)。

若你先前已經跑過 \`init\`，升到 v0.7.1 後要再執行一次。
`;

test("applyReleaseVersion 改 package.json version 與 README 目前版本", () => {
  const result = applyReleaseVersion({
    version: "0.17.0",
    packageJson: samplePkg,
    readme: sampleReadme,
  });
  assert.equal(JSON.parse(result.packageJson).version, "0.17.0");
  assert.match(result.readme, /目前版本：\*\*v0\.17\.0\*\*/);
  assert.match(result.readme, /升到 v0\.7\.1 後要再執行一次/);
  assert.equal(result.changed, true);
});

test("applyReleaseVersion 已同號則 changed 為 false", () => {
  const result = applyReleaseVersion({
    version: "0.14.1",
    packageJson: samplePkg,
    readme: sampleReadme,
  });
  assert.equal(result.changed, false);
  assert.equal(result.packageJson, samplePkg);
  assert.equal(result.readme, sampleReadme);
});

test("applyReleaseVersion 找不到目前版本行則 throw", () => {
  assert.throws(
    () =>
      applyReleaseVersion({
        version: "0.17.0",
        packageJson: samplePkg,
        readme: "# no version line\n升到 v0.7.1 後要再執行一次\n",
      }),
    /目前版本/,
  );
});
