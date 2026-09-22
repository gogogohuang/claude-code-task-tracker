import assert from "node:assert/strict";
import test from "node:test";
import type { InspectEntry } from "./types.js";
import {
  attachByteSizes,
  formatByteSize,
  heatSummaryLines,
  sortEntriesByHeat,
} from "./heat.js";

function entry(
  overrides: Partial<InspectEntry> & Pick<InspectEntry, "section" | "label" | "absolutePath">,
): InspectEntry {
  return {
    id: `${overrides.section}:${overrides.absolutePath}`,
    status: "present",
    ...overrides,
  };
}

test("formatByteSize：B／KB／MB／GB", () => {
  assert.equal(formatByteSize(500), "500 B");
  assert.equal(formatByteSize(12_400), "12.1 KB");
  assert.equal(formatByteSize(1_500_000), "1.4 MB");
  assert.equal(formatByteSize(1_610_612_736), "1.5 GB");
});

test("sortEntriesByHeat：section 順序固定，同 section 內 byte 降序，無 size 置末", () => {
  const sorted = sortEntriesByHeat([
    entry({ section: "onDemand", label: "small", absolutePath: "/o/s", byteSize: 10 }),
    entry({ section: "launch", label: "tiny", absolutePath: "/l/t", byteSize: 1 }),
    entry({ section: "launch", label: "big", absolutePath: "/l/b", byteSize: 100 }),
    entry({ section: "launch", label: "nosize", absolutePath: "/l/n" }),
    entry({ section: "outOfSession", label: "x", absolutePath: "/x", byteSize: 50 }),
  ]);
  assert.deepEqual(
    sorted.map((e) => e.label),
    ["big", "tiny", "nosize", "small", "x"],
  );
});

test("heatSummaryLines：launch＋onDemand Top-N（開場偏重常見來源在 onDemand）", () => {
  const lines = heatSummaryLines(
    [
      entry({ section: "launch", label: "A", absolutePath: "/a", byteSize: 3000 }),
      entry({ section: "launch", label: "B", absolutePath: "/b", byteSize: 1000 }),
      entry({ section: "launch", label: "C", absolutePath: "/c", byteSize: 2000 }),
      entry({ section: "onDemand", label: "D", absolutePath: "/d", byteSize: 99999 }),
      entry({ section: "outOfSession", label: "X", absolutePath: "/x", byteSize: 9_000_000 }),
      entry({ section: "launch", label: "E", absolutePath: "/e" }),
    ],
    2,
  );
  assert.deepEqual(lines, ["D · 97.7 KB", "A · 2.9 KB"]);
});

test("heatSummaryLines：無資料 → 空陣列", () => {
  assert.deepEqual(heatSummaryLines([], 5), []);
});

test("attachByteSizes：missing 不 stat；有檔寫入 size", () => {
  const missing = attachByteSizes([
    entry({ section: "launch", label: "m", absolutePath: "/no/such/file", status: "missing" }),
  ]);
  assert.equal(missing[0]!.byteSize, undefined);
});
