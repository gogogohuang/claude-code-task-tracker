import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLineLabel,
  formatLastTurnBreakdownLine,
  formatOccupiedTokensLine,
  formatSnapshotActivityLine,
  lastTurnUsageFromStats,
} from "./context-snapshot.js";
import { Activity } from "./schema.js";

test("formatOccupiedTokensLine 用 1,000,000 當分母並標「約」", () => {
  assert.equal(formatOccupiedTokensLine(686300), "窗口約 686,300 token（約 69%）");
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

test("activityLineLabel running 前置 ◐", () => {
  assert.equal(activityLineLabel(running), "◐ 正在讀取 src/schema.ts");
});

test("activityLineLabel 沒有 summary 時用工具名 fallback", () => {
  assert.equal(
    activityLineLabel({ toolName: "Bash", phase: "done", at: "t" }),
    "已使用 Bash",
  );
});

test("formatSnapshotActivityLine 組活動句與任務數", () => {
  assert.equal(
    formatSnapshotActivityLine({ activity: running, done: 3, total: 10 }),
    "◐ 正在讀取 src/schema.ts · 任務 3/10",
  );
});

test("formatSnapshotActivityLine 沒有活動且任務總數為 0 時整行省略", () => {
  assert.equal(formatSnapshotActivityLine({ done: 0, total: 0 }), undefined);
});

test("formatSnapshotActivityLine 沒有活動但有任務時仍顯示任務數", () => {
  assert.equal(formatSnapshotActivityLine({ done: 1, total: 2 }), "任務 1/2");
});
