import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLineLabel,
  contextOccupancyPct,
  formatContextGaugeBar,
  formatLastTurnBreakdownLine,
  formatOccupiedTokensLine,
  formatSnapshotActivityLine,
  lastTurnUsageFromStats,
} from "./context-snapshot.js";
import { Activity } from "./schema.js";

test("formatOccupiedTokensLine 用 1,000,000 當分母並標「約」", () => {
  assert.equal(formatOccupiedTokensLine(686300), "窗口約 686,300 token（約 69%）");
});

test("formatContextGaugeBar 沒有用量時不畫", () => {
  assert.equal(formatContextGaugeBar(undefined), undefined);
});

test("formatContextGaugeBar 依佔用比例上色與填滿", () => {
  assert.equal(contextOccupancyPct(500_000), 50);
  assert.deepEqual(formatContextGaugeBar(500_000), {
    bar: `${"█".repeat(12)}${"░".repeat(12)}`,
    color: "green",
  });
  assert.equal(formatContextGaugeBar(800_000)?.color, "yellow");
  assert.equal(formatContextGaugeBar(950_000)?.color, "red");
});

test("formatOccupiedTokensLine 沒有用量資料", () => {
  assert.equal(formatOccupiedTokensLine(undefined), "還沒有用量資料");
});

test("formatLastTurnBreakdownLine 拆 cache read / create / input", () => {
  assert.equal(
    formatLastTurnBreakdownLine({ occupiedTokens: 260, cacheRead: 200, cacheCreation: 10, input: 50 }),
    "上一輪 cache read 200 · cache create 10 · input 50",
  );
});

test("formatLastTurnBreakdownLine 沒有上一輪時省略", () => {
  assert.equal(formatLastTurnBreakdownLine(undefined), undefined);
});

test("contextOccupancyPct 可指定視窗（Codex 258,400）", () => {
  assert.equal(contextOccupancyPct(129_200, 258_400), 50);
  assert.equal(contextOccupancyPct(500_000), 50); // 不傳＝1,000,000，Claude 不變
});

test("formatOccupiedTokensLine／formatContextGaugeBar 傳入視窗後用該視窗算比例", () => {
  assert.equal(formatOccupiedTokensLine(129_200, 258_400), "窗口約 129,200 token（約 50%）");
  assert.deepEqual(formatContextGaugeBar(129_200, 258_400), {
    bar: `${"█".repeat(12)}${"░".repeat(12)}`,
    color: "green",
  });
});

test("formatLastTurnBreakdownLine：Codex 顯示 cached／新算，不出現 cache create", () => {
  const usage = { occupiedTokens: 17111, cacheRead: 16128, cacheCreation: 983, input: 0 };
  assert.equal(formatLastTurnBreakdownLine(usage, "codex"), "上一輪 cached 16,128 · 新算 983");
  assert.match(formatLastTurnBreakdownLine(usage) ?? "", /cache create 983/); // 預設 claude 不變
});

test("lastTurnUsageFromStats 欄位齊全才組得出來", () => {
  assert.deepEqual(
    lastTurnUsageFromStats({
      lastOccupiedTokens: 125,
      lastCacheRead: 20,
      lastCacheCreation: 100,
      lastInput: 5,
    }),
    { occupiedTokens: 125, cacheRead: 20, cacheCreation: 100, input: 5 },
  );
  assert.equal(lastTurnUsageFromStats({ lastOccupiedTokens: 125 }), undefined);
});

const running: Activity = {
  toolName: "Read",
  phase: "running",
  summary: "正在讀取 src/schema.ts",
  at: "2026-09-15T00:00:00.000Z",
};

test("activityLineLabel running 前置 ◐ 與 tool 名", () => {
  assert.equal(activityLineLabel(running), "◐ Read · 正在讀取 src/schema.ts");
});

test("activityLineLabel 沒有 summary 時用工具名 fallback", () => {
  assert.equal(
    activityLineLabel({ toolName: "Bash", phase: "done", at: "t" }),
    "Bash · 已使用 Bash",
  );
});

test("formatSnapshotActivityLine 組活動句與任務數", () => {
  assert.equal(
    formatSnapshotActivityLine({ activity: running, done: 3, total: 10 }),
    "◐ Read · 正在讀取 src/schema.ts · 任務 3/10",
  );
});

test("formatSnapshotActivityLine 沒有活動且任務總數為 0 時整行省略", () => {
  assert.equal(formatSnapshotActivityLine({ done: 0, total: 0 }), undefined);
});

test("formatSnapshotActivityLine 沒有活動但有任務時仍顯示任務數", () => {
  assert.equal(formatSnapshotActivityLine({ done: 1, total: 2 }), "任務 1/2");
});

test("contextOccupancyPct 視窗為 0 或負數時退回 1,000,000", () => {
  assert.equal(contextOccupancyPct(500_000, 0), 50);
  assert.equal(contextOccupancyPct(500_000, -1), 50);
});
