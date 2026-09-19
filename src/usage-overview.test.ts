import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsageOverview,
  formatShareBar,
  formatTokenCount,
  formatUsageOverviewLine,
  summarizeUsageOverview,
  type UsageOverviewInput,
} from "./usage-overview.js";

function input(sessionId: string, workTokens: number | undefined, agent: "claude" | "codex" = "claude"): UsageOverviewInput {
  return { sessionId, label: `proj · ${sessionId}`, agent, workTokens };
}

test("formatTokenCount：邊界值", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1_000), "1K");
  assert.equal(formatTokenCount(12_345), "12.3K");
  assert.equal(formatTokenCount(999_949), "999.9K");
  assert.equal(formatTokenCount(999_999), "1M");
  assert.equal(formatTokenCount(1_000_000), "1M");
  assert.equal(formatTokenCount(2_345_678), "2.3M");
});

test("buildUsageOverview：有資料者由大到小、同值依 sessionId 穩定排序、無資料排最後", () => {
  const rows = buildUsageOverview([
    input("c", undefined),
    input("b", 100),
    input("a", 100),
    input("d", 300),
  ]);
  assert.deepEqual(rows.map((row) => row.sessionId), ["d", "a", "b", "c"]);
});

test("buildUsageOverview：百分比占「有資料的 session 總和」，四捨五入；無資料為 undefined", () => {
  const rows = buildUsageOverview([input("a", 300), input("b", 100), input("c", undefined)]);
  assert.deepEqual(rows.map((row) => row.sharePct), [75, 25, undefined]);
  const thirds = buildUsageOverview([input("a", 1), input("b", 1), input("c", 1)]);
  assert.deepEqual(thirds.map((row) => row.sharePct), [33, 33, 33]);
});

test("buildUsageOverview：total 為 0 時百分比全為 0；空輸入回空陣列；不改動輸入陣列", () => {
  assert.deepEqual(buildUsageOverview([input("a", 0), input("b", 0)]).map((row) => row.sharePct), [0, 0]);
  assert.deepEqual(buildUsageOverview([]), []);
  const original = [input("b", 1), input("a", 2)];
  buildUsageOverview(original);
  assert.deepEqual(original.map((row) => row.sessionId), ["b", "a"]);
});

test("formatShareBar：依百分比填滿 12 格，並夾在 0-12 之間", () => {
  assert.equal(formatShareBar(0), "░".repeat(12));
  assert.equal(formatShareBar(50), `${"█".repeat(6)}${"░".repeat(6)}`);
  assert.equal(formatShareBar(100), "█".repeat(12));
  assert.equal(formatShareBar(150), "█".repeat(12));
  assert.equal(formatShareBar(-5), "░".repeat(12));
  assert.equal(formatShareBar(50, 4), "██░░");
});

test("formatUsageOverviewLine：有資料與無資料", () => {
  const [row] = buildUsageOverview([{ sessionId: "s1", label: "p", agent: "codex", workTokens: 1_500 }]);
  assert.equal(formatUsageOverviewLine(row), `[Codex] p  1.5K  100%  ${"█".repeat(12)}`);
  const [empty] = buildUsageOverview([{ sessionId: "s2", label: "p", agent: "claude", workTokens: undefined }]);
  assert.equal(formatUsageOverviewLine(empty), "[Claude] p  —");
});

test("summarizeUsageOverview：session 數、有資料數、合計", () => {
  const rows = buildUsageOverview([input("a", 300), input("b", 100), input("c", undefined)]);
  assert.deepEqual(summarizeUsageOverview(rows), { sessions: 3, measured: 2, totalTokens: 400 });
  assert.deepEqual(summarizeUsageOverview([]), { sessions: 0, measured: 0, totalTokens: 0 });
});
