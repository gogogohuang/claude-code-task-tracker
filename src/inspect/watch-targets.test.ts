import assert from "node:assert/strict";
import test from "node:test";
import { InspectModel } from "./types.js";
import { watchTargets } from "./watch-targets.js";

test("watchTargets 包含 config、cwd、項目路徑與父目錄，且不重複", () => {
  const model: InspectModel = {
    cwd: "/proj",
    configDir: "/home/me/.claude",
    headerNotes: [],
    warnings: [],
    entries: [
      {
        id: "launch:/proj/CLAUDE.md",
        section: "launch",
        label: "CLAUDE.md",
        absolutePath: "/proj/CLAUDE.md",
        status: "present",
      },
    ],
  };
  const targets = watchTargets(model);
  assert.equal(new Set(targets).size, targets.length);
  assert.equal(targets.includes("/proj"), true);
  assert.equal(targets.includes("/proj/CLAUDE.md"), true);
  assert.equal(targets.includes("/home/me/.claude"), true);
});
