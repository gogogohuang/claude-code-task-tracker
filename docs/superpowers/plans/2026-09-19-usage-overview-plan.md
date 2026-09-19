# 用量總覽 panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `watch` 按 `u` 開啟「用量總覽」panel：列出所有已知 session（Claude 與 Codex 混合），依累計「新增工作量」token 由大到小排序，每列顯示累計 token、占全部的百分比與比例條。

**Architecture:** `accumulate` 多記一個 `workTokensTotal`（`input + cacheCreation + output`，不含 cache 讀取），Claude 與 Codex 共用同一條公式（Codex 解析器已把欄位對應好）。排序、百分比、格式化放在一個純函式模組 `src/usage-overview.ts`；畫面是新的 `UsagePanel`，由 `App.tsx` 新增 `usage` 這個 view 與 `u` 鍵接上。

**Tech Stack:** TypeScript、ink（React TUI）、`node --import tsx --test`（`node:test` + `node:assert/strict`）、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-19-usage-overview-design.md`（Codex 對應欄位見 `docs/superpowers/specs/2026-09-19-codex-usage-design.md`）

## Global Constraints

- 套件管理 `pnpm@9.11.0`，Node `>=18`；驗證指令：`pnpm typecheck`、`pnpm test`（提交前兩者都要過）。
- 前置條件：Codex 用量計畫（`docs/superpowers/plans/2026-09-19-codex-usage-plan.md`）已在同一條分支完成——`parseCodexRollout`、`SessionUsageStats.agent`、`prime`／`refresh(agent)` 都已存在。
- Claude 既有行為與文案不變：既有測試須全數通過。
- 用量的定義（spec）：「新增工作量」token = `input + cacheCreation + output`，**不含 cache 讀取**；只計主線、已通過 messageId 去重的 usage 事件；子 agent（sidechain）事件被 `accumulate` 略過，因此不計入（限制，寫進 README）。
- 使用者可見文字用繁體中文（台灣用語）；`tsconfig` 開了 `noUnusedLocals`、`noUnusedParameters`。
- 測試檔放在被測檔旁邊，`*.test.ts`；`src/*.test.ts`、`src/usage/*.test.ts` 已在 `pnpm test` 的 glob 內。單一測試檔：`node --import tsx --test <path>`。
- commit 訊息：`type: 中文描述`，空一行後接 `Co-Authored-By:` 行（用 heredoc，確保空行真的存在）。不升版本號。
- 分支：沿用目前的功能分支，不要新開；`u` 鍵在 `src/ui/App.tsx` 目前未被使用（已用：q、Tab、`[`、`]`、v、b、d、a、n、s、t、h、p、c、C）。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/usage/types.ts` | 修改 | `SessionUsageStats.workTokensTotal?` |
| `src/usage/accumulate.ts` | 修改 | 逐事件累加 `workTokensTotal` |
| `src/usage-overview.ts` | 新增 | 純函式：排序、百分比、token 格式化、比例條、每列文字、摘要 |
| `src/delete-session.ts` | 修改 | `WatchView` 加 `"usage"` |
| `src/ui/UsagePanel.tsx` | 新增 | 可捲動的總覽 panel（比照 `ToolsPanel`） |
| `src/ui/App.tsx` | 修改 | `u` 鍵、`usage` view 的渲染與 `b` 返回 |
| `src/ui/TaskList.tsx` | 修改 | 畫面下方按鍵提示加 `按 u 用量總覽` |
| `README.md` | 修改 | 按鍵列表、新增〈用量總覽〉說明與限制 |

---

### Task 1: 統計加上累計新增工作量

**Files:**
- Modify: `src/usage/types.ts`（`SessionUsageStats`）
- Modify: `src/usage/accumulate.ts`（最後的 `stats = {...}` 區塊）
- Test: `src/usage/accumulate.test.ts`（檔尾追加）

**Interfaces:**
- Produces: `SessionUsageStats.workTokensTotal?: number`——第一個通過去重的主線 usage 事件之後才出現；沒有 usage 事件的 stats 物件不帶這個鍵。

- [ ] **Step 1: 寫失敗的測試**

追加到 `src/usage/accumulate.test.ts`（檔頭已 import `accumulate`、`createSessionUsageStats`、`ParsedEvent`；不要動既有 helper）：

```typescript
function workEvent(
  messageId: string | undefined,
  usage: { input: number; cacheCreation: number; cacheRead: number; output: number },
  isSidechain = false,
): ParsedEvent {
  return { messageId, isSidechain, timestamp: "t", usage, toolResultChars: undefined };
}

test("accumulate：workTokensTotal 逐事件累加 input + cacheCreation + output，不含 cacheRead", () => {
  const { next } = accumulate(createSessionUsageStats("s1"), [
    workEvent("a", { input: 10, cacheCreation: 200, cacheRead: 5000, output: 30 }),
    workEvent("b", { input: 1, cacheCreation: 2, cacheRead: 9000, output: 3 }),
  ]);
  assert.equal(next.workTokensTotal, 246); // (10 + 200 + 30) + (1 + 2 + 3)
});

test("accumulate：重複 messageId 不重複累加 workTokensTotal", () => {
  const usage = { input: 0, cacheCreation: 200, cacheRead: 0, output: 40 };
  const { next } = accumulate(createSessionUsageStats("s1"), [workEvent("a", usage), workEvent("a", usage)]);
  assert.equal(next.workTokensTotal, 240);
});

test("accumulate：sidechain（子 agent）事件不計入 workTokensTotal", () => {
  const { next } = accumulate(createSessionUsageStats("s1"), [
    workEvent("a", { input: 0, cacheCreation: 100, cacheRead: 0, output: 0 }),
    workEvent("b", { input: 0, cacheCreation: 9999, cacheRead: 0, output: 9999 }, true),
  ]);
  assert.equal(next.workTokensTotal, 100);
});

test("accumulate：沒有 usage 的事件不產生 workTokensTotal 這個鍵", () => {
  const { next } = accumulate(createSessionUsageStats("s1"), [
    { messageId: undefined, isSidechain: false, timestamp: "t", usage: undefined, toolResultChars: { toolName: "Bash", chars: 10 } },
  ]);
  assert.equal("workTokensTotal" in next, false);
});

test("accumulate：Codex 對應（input 0、cacheCreation = 沒命中 cache 的部分）也用同一條公式", () => {
  const { next } = accumulate(createSessionUsageStats("cx", "codex"), [
    workEvent("total:32900", { input: 0, cacheCreation: 983, cacheRead: 16128, output: 24 }),
  ]);
  assert.equal(next.workTokensTotal, 1007);
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --import tsx --test src/usage/accumulate.test.ts`
Expected: 新增的五個測試中，第 1、2、3、5 個 FAIL（`workTokensTotal` 為 `undefined`）；第 4 個「沒有 usage 的事件不產生這個鍵」本來就會通過，它是防止之後退化的守門測試。

- [ ] **Step 3: 實作**

`src/usage/types.ts`，在 `SessionUsageStats` 的 `lastContextWindow?` 之後加：

```typescript
  /**
   * 累計「新增工作量」token：input + cacheCreation + output，不含 cache 讀取。
   * 只計主線、已通過 messageId 去重的 usage 事件（子 agent 的 sidechain 事件被 accumulate 略過，不計入）。
   */
  workTokensTotal?: number;
```

`src/usage/accumulate.ts`，在 `stats = { ...stats, mainThreadMsgCount, ... }` 內、`lastInput: event.usage.input,` 這行之後（`...(event.usage.contextWindow ...)` 之前）加：

```typescript
      workTokensTotal:
        (stats.workTokensTotal ?? 0) + event.usage.input + event.usage.cacheCreation + event.usage.output,
```

- [ ] **Step 4: 執行確認通過**

Run: `node --import tsx --test src/usage/accumulate.test.ts && pnpm typecheck && pnpm test`
Expected: 全部 PASS；既有測試沒有整份比對 stats 物件，不會因為多一個鍵而失敗。若有既有測試因新鍵失敗，只在它的期望值補上 `workTokensTotal`，不改其他斷言。

- [ ] **Step 5: Commit**

```bash
git add src/usage/types.ts src/usage/accumulate.ts src/usage/accumulate.test.ts
git commit -F - <<'EOF'
feat: 統計加上累計新增工作量 workTokensTotal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: 用量總覽的純函式模組

**Files:**
- Create: `src/usage-overview.ts`
- Test: `src/usage-overview.test.ts`

**Interfaces:**
- Consumes: `Agent`、`TAB_LABELS`（`src/agent.ts`）。
- Produces（Task 3 依賴，簽名必須一字不差）：
  - `interface UsageOverviewInput { sessionId: string; label: string; agent: Agent; workTokens: number | undefined }`
  - `interface UsageOverviewRow extends UsageOverviewInput { sharePct: number | undefined }`
  - `buildUsageOverview(inputs: readonly UsageOverviewInput[]): UsageOverviewRow[]`
  - `formatTokenCount(tokens: number): string`
  - `formatShareBar(sharePct: number, width?: number): string`（預設 `SHARE_BAR_WIDTH = 12`）
  - `formatUsageOverviewLine(row: UsageOverviewRow): string`
  - `summarizeUsageOverview(rows: readonly UsageOverviewRow[]): { sessions: number; measured: number; totalTokens: number }`

- [ ] **Step 1: 寫失敗的測試**

`src/usage-overview.test.ts`：

```typescript
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
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --import tsx --test src/usage-overview.test.ts`
Expected: FAIL，`Cannot find module './usage-overview.js'`。

- [ ] **Step 3: 實作**

`src/usage-overview.ts`：

```typescript
import { TAB_LABELS, type Agent } from "./agent.js";

export const SHARE_BAR_WIDTH = 12;

export interface UsageOverviewInput {
  sessionId: string;
  /** 畫面上的名稱，例如「專案名 · 短 session id」。 */
  label: string;
  agent: Agent;
  /** 累計新增工作量 token；undefined = 還沒有用量資料。 */
  workTokens: number | undefined;
}

export interface UsageOverviewRow extends UsageOverviewInput {
  /** 占「有資料的 session 總和」的百分比（四捨五入到整數）；無資料為 undefined。 */
  sharePct: number | undefined;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** 999 → "999"、12_345 → "12.3K"、2_345_678 → "2.3M"；四捨五入後不足 1M 會進位成 "1M"，不會出現 "1000K"。 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(Math.max(0, Math.round(tokens)));
  const thousands = Math.round(tokens / 100) / 10;
  if (thousands < 1_000) return `${trimZero(thousands)}K`;
  return `${trimZero(Math.round(tokens / 100_000) / 10)}M`;
}

export function formatShareBar(sharePct: number, width: number = SHARE_BAR_WIDTH): string {
  const filled = Math.min(width, Math.max(0, Math.round((sharePct / 100) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

/** 有資料者依 workTokens 由大到小（同值依 sessionId），無資料者排最後；回傳新陣列，不改動輸入。 */
export function buildUsageOverview(inputs: readonly UsageOverviewInput[]): UsageOverviewRow[] {
  const total = inputs.reduce((sum, item) => sum + (item.workTokens ?? 0), 0);
  const rows: UsageOverviewRow[] = inputs.map((item) => ({
    ...item,
    sharePct:
      item.workTokens === undefined ? undefined : total === 0 ? 0 : Math.round((item.workTokens / total) * 100),
  }));
  return rows.sort((left, right) => {
    if (left.workTokens === undefined && right.workTokens === undefined) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    if (left.workTokens === undefined) return 1;
    if (right.workTokens === undefined) return -1;
    if (right.workTokens !== left.workTokens) return right.workTokens - left.workTokens;
    return left.sessionId.localeCompare(right.sessionId);
  });
}

export function formatUsageOverviewLine(row: UsageOverviewRow): string {
  const source = `[${TAB_LABELS[row.agent]}]`;
  if (row.workTokens === undefined || row.sharePct === undefined) return `${source} ${row.label}  —`;
  return `${source} ${row.label}  ${formatTokenCount(row.workTokens)}  ${row.sharePct}%  ${formatShareBar(row.sharePct)}`;
}

export function summarizeUsageOverview(rows: readonly UsageOverviewRow[]): {
  sessions: number;
  measured: number;
  totalTokens: number;
} {
  let measured = 0;
  let totalTokens = 0;
  for (const row of rows) {
    if (row.workTokens === undefined) continue;
    measured += 1;
    totalTokens += row.workTokens;
  }
  return { sessions: rows.length, measured, totalTokens };
}
```

- [ ] **Step 4: 執行確認通過**

Run: `node --import tsx --test src/usage-overview.test.ts && pnpm typecheck`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/usage-overview.ts src/usage-overview.test.ts
git commit -F - <<'EOF'
feat: 用量總覽的排序、百分比與格式化純函式

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 用量總覽 panel 與 `u` 鍵

**Files:**
- Modify: `src/delete-session.ts:8`（`WatchView`）
- Test: `src/delete-session.test.ts`（追加）
- Create: `src/ui/UsagePanel.tsx`
- Modify: `src/ui/App.tsx`（import、`u` 鍵、`b` 返回、`usage` view 渲染）
- Modify: `src/ui/TaskList.tsx:252`（按鍵提示）

**Interfaces:**
- Consumes: Task 1 的 `workTokensTotal`（經 `peek(sessionId)`）、Task 2 的 `buildUsageOverview`、`formatUsageOverviewLine`、`summarizeUsageOverview`、`formatTokenCount`；`hintsFor`、`shortSessionId`、`basename`、`peek`、`withNotice`、`topNotice` 在 `App.tsx` 內已存在。
- Produces: `WatchView` 多一個 `"usage"`；使用者可見行為（`u` 開、`b` 回）。

App.tsx 沒有元件測試；可測的邏輯都在 Task 1、2。本 task 以 typecheck、既有測試與實機驗證把關。

- [ ] **Step 1: 寫失敗的測試（型別層）**

追加到 `src/delete-session.test.ts`：

```typescript
test("shouldHandleDeleteKey 在用量總覽（usage）不處理刪除鍵", () => {
  assert.equal(shouldHandleDeleteKey("usage", "s1"), false);
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `pnpm typecheck`
Expected: FAIL，`Argument of type '"usage"' is not assignable to parameter of type 'WatchView'`（tsx 執行時不檢查型別，所以「失敗」體現在 typecheck）。

- [ ] **Step 3: 實作**

`src/delete-session.ts`：

```typescript
export type WatchView = "main" | "advice" | "cache" | "tools" | "history" | "split" | "usage";
```

新增 `src/ui/UsagePanel.tsx`（結構比照 `src/ui/ToolsPanel.tsx`，只換標題與資料來源）：

```tsx
import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 6;

export function UsagePanel({
  header,
  lines,
  emptyHint,
}: {
  header: string;
  lines: string[];
  emptyHint: string;
}) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const displayLines = lines.length > 0 ? lines : [emptyHint];
  const pageSize = pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS);
  const start = clampScrollOffset(offset, displayLines.length, pageSize);
  const visible = visibleSlice(displayLines, start, pageSize);
  const hiddenBelow = Math.max(0, displayLines.length - start - visible.length);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOffset((currentOffset) => clampScrollOffset(currentOffset, displayLines.length, pageSize));
  }, [displayLines.length, pageSize]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset + 1, displayLines.length, pageSize));
      }
      if (input === "k" || key.upArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset - 1, displayLines.length, pageSize));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{header}</Text>
      </Box>
      <Box flexDirection="column">
        {start > 0 ? <Text dimColor>↑ 還有 {start} 行</Text> : null}
        {visible.map((line, index) => (
          <Text key={`${start + index}-${line.slice(0, 24)}`} wrap="truncate-end">
            {line}
          </Text>
        ))}
        {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 行</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>累計新增工作量（不含 cache 讀取；Claude 不含子 agent）· ↑↓ 捲動 — 按 b 回上一頁</Text>
      </Box>
    </Box>
  );
}
```

`src/ui/App.tsx`：

1. import 區加（與其他 `../usage/...` import 放在一起）：

```typescript
import { UsagePanel } from "./UsagePanel.js";
import {
  buildUsageOverview,
  formatTokenCount,
  formatUsageOverviewLine,
  summarizeUsageOverview,
} from "../usage-overview.js";
```

2. 在 `h` 鍵處理（`if (input === "h" && (view === "main" || view === "split") && actionSessionId) { ... }`）之後、`p` 鍵之前加：

```typescript
      if (input === "u" && (view === "main" || view === "split")) {
        setPendingDeleteSessionId(undefined);
        setView("usage");
        return;
      }
```

（`u` 不需要選定 session，所以在 session 列表畫面也能按；列表畫面的 `view` 就是 `"main"`。）

3. 把 `b` 返回那一行

```typescript
      if (view === "advice" || view === "cache" || view === "tools" || view === "history") {
```

改成

```typescript
      if (view === "advice" || view === "cache" || view === "tools" || view === "history" || view === "usage") {
```

4. 在 `history` view 的渲染區塊（`if (view === "history" && selectedSessionId) { ... }`）之後、`if (!selectedSessionId) {` 之前加：

```tsx
  if (view === "usage") {
    const rows = buildUsageOverview(
      hintsFor(sessionIds).flatMap((hint) =>
        hint.cwd
          ? [
              {
                sessionId: hint.sessionId,
                label: `${basename(hint.cwd)} · ${shortSessionId(hint.sessionId)}`,
                agent: hint.agent ?? ("claude" as const),
                workTokens: peek(hint.sessionId)?.workTokensTotal,
              },
            ]
          : [],
      ),
    );
    const summary = summarizeUsageOverview(rows);
    return withNotice(
      topNotice,
      <UsagePanel
        header={`用量總覽 · ${summary.sessions} 個 session（${summary.measured} 個有用量資料）· 合計 ${formatTokenCount(summary.totalTokens)} token`}
        lines={rows.map(formatUsageOverviewLine)}
        emptyHint="還沒有可列出的 session"
      />,
    );
  }
```

`src/ui/TaskList.tsx` 約 L252 的按鍵提示，在 `— 按 h 活動紀錄` 之後加 `— 按 u 用量總覽`：

```
最後更新：… — ↑↓ 捲動 — 按 s 暫存 — 按 a 用量 — 按 t 工具 — 按 h 活動紀錄 — 按 u 用量總覽 — 按 b 回列表 — 按 d 清除暫存 — 按 q 離開
```

（只改這一段文字，保留該行其餘內容；若有測試比對這段文字，同步更新期望值。）

- [ ] **Step 4: 執行確認通過**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 無錯；全部測試 PASS（含新增的 `shouldHandleDeleteKey("usage", ...)`）。

- [ ] **Step 5: 實機驗證（留給使用者，implementer 不要自己開互動 `watch`）**

1. `pnpm build`，在使用者環境跑新版 `watch`，同時有至少一個 Claude session 與一個 Codex session（後者要已送出 prompt）。
2. 在 session 列表畫面按 `u`：出現「用量總覽 · N 個 session（M 個有用量資料）· 合計 X token」，每列 `[Claude|Codex] 專案 · 短id  數量  百分比  比例條`，由大到小排序；按 `b` 回到列表。
3. 進入某個 session 後按 `u`，再按 `b`：回到該 session 的主畫面；在 split 檢視按 `u`、`b`：回到 split。
4. 在總覽畫面按 `d`：不會進入刪除流程。
5. 沒有用量資料的 session 顯示 `—`，且不影響其他列的百分比。
6. 數字合理性：挑一個 Claude session，比對總覽數字與 transcript 中各則 assistant 訊息的 `input + cache_creation + output` 加總（不含 `cache_read`），數量級應一致。

- [ ] **Step 6: Commit**

```bash
git add src/delete-session.ts src/delete-session.test.ts src/ui/UsagePanel.tsx src/ui/App.tsx src/ui/TaskList.tsx
git commit -F - <<'EOF'
feat: watch 按 u 開啟用量總覽 panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 3 的行為（`u` 鍵、排序、`—`、限制）。文字必須與實際行為一致：Claude 累計不含子 agent；不含 cache 讀取；每次啟動 `watch` 由 transcript 重算。

- [ ] **Step 1: 更新按鍵列表**

在 README「畫面內按 `q` 離開、按 `b` 回上一層…」那一長句（`grep -n '畫面內按 `q` 離開' README.md` 找到）裡，於「按 `h` 查看活動紀錄」之後加上「、按 `u` 開啟用量總覽（所有 session 依累計用量排序）」，其餘文字不動。

- [ ] **Step 2: 新增〈用量總覽〉說明**

在「用量建議（watch 按 `a`）會列出…」那一段（`grep -n '用量建議（watch 按' README.md`）之後、下一個標題之前，插入：

````markdown
### 用量總覽（`u`）

`watch` 按 `u` 會列出所有已知 session（Claude 與 Codex 混合，標示來源），依累計用量由大到小排序，
每列顯示累計 token、占全部的百分比與一條比例條：

```text
[Claude] my-project · 1a2b3c4d  2.3M  41%  █████░░░░░░░
[Codex]  other-repo · 9f8e7d6c  1.1M  20%  ██░░░░░░░░░░
```

- **用量的算法**：累計「新增工作量」token = `input + cache creation + output`（Codex：`input − cached + output`），
  **不含 cache 讀取**。Claude 每輪都會重讀整個 context，把 cache 讀取也累加會讓數字被灌爆，失去比較意義。
- 百分比是占「有用量資料的 session 總和」的比例；還沒有用量資料的 session 顯示 `—`，不參與計算。
- 累計值在每次啟動 `watch` 時由 transcript 重算，不另外存檔。
- **限制**：Claude 子 agent（sidechain）用到的 token 不計入累計，重度使用子 agent 的 session 會被低估；
  比較的是工作量，不是花費（不同來源的 token 單價不同）。
````

- [ ] **Step 3: 驗證**

Run: `pnpm typecheck && pnpm test`
Expected: PASS（README 不影響測試，這一步確認沒有誤動程式碼）。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -F - <<'EOF'
docs: README 補上用量總覽 panel 的說明與限制

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## 完成後

- 使用者做 Task 3 Step 5 的實機驗證。
- 收尾方式（push／PR）由使用者決定；PR 不升版本號（依 `AGENTS.md`，發版另做）。
- 下一個子專案：「等你（核可提示）」——Codex 的 `PermissionRequest` hook，另寫 spec。
