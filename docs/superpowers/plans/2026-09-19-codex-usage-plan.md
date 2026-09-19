# Codex 用量／cache 建議 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex session 在 `watch` 也能看到用量／cache 建議（long-session、cache-spike、fat-tool-result、heavy-baseline）與正確的 context 量表。

**Architecture:** 新增 Codex rollout 解析器，把 `token_count` 與工具輸出轉成現有的 `ParsedEvent`，重用 `accumulate`／`detect`／`tail-runtime`。狀態檔新增 `transcriptPath` 讓 watch 知道要 tail 哪個 rollout；context 視窗改成隨統計帶入；建議文案依來源切換。

**Tech Stack:** TypeScript、zod、ink（React TUI）、`node --import tsx --test`（`node:test` + `node:assert/strict`）、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-19-codex-usage-design.md`

## Global Constraints

- 套件管理 `pnpm@9.11.0`，Node `>=18`；驗證指令：`pnpm typecheck`、`pnpm test`（提交前兩者都要過）。
- Claude 行為與文案完全不變：既有測試須全數通過，新欄位一律 optional，且**只有 Codex 才寫入**（用條件展開 `...(cond ? { k: v } : {})`，避免在 Claude 資料上多出值為 `undefined` 的鍵而弄壞既有 `deepEqual`）。
- 使用者可見文字用繁體中文（台灣用語）。
- 測試檔放在被測檔旁邊，`*.test.ts`；`src/usage/*.test.ts` 已在 `pnpm test` 的 glob 內。
- 單一測試檔執行：`node --import tsx --test <path>`。
- commit 訊息以中文為主、`type:` 前綴，結尾加 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。
- 分支：`gogogohuang/codex-session-detect`（已存在，不要新開）。功能改動不升版本號。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/schema.ts` | 修改 | `TaskStateSchema` 新增 optional `transcriptPath` |
| `src/hook/apply-event.ts` | 修改 | Codex hook 寫入 `transcriptPath` |
| `src/usage/types.ts` | 修改 | `ParsedUsage.contextWindow`、`SessionUsageStats.agent`／`lastContextWindow`、`createSessionUsageStats(id, agent)` |
| `src/usage/codex-rollout.ts` | 新增 | `parseCodexRollout`：rollout jsonl → `ParsedEvent[]` |
| `src/fixtures/codex-0.155.1-rollout-sample.jsonl` | 新增 | 去識別化的 Codex rollout 樣本 |
| `src/usage/accumulate.ts` | 修改 | 記下 `lastContextWindow` |
| `src/context-snapshot.ts` | 修改 | 佔用率函式加視窗參數；Codex 版上一輪明細 |
| `src/usage/detect.ts` | 修改 | 建議文案依 `stats.agent` 切換、佔用率用實際視窗 |
| `src/usage/tail-runtime.ts` | 修改 | 依 agent 選解析器 |
| `src/usage/transcript-source.ts` | 新增 | 由狀態檔決定要 tail 哪個檔（Claude／Codex 共用入口） |
| `src/ui/App.tsx` | 修改 | 用 `transcriptSource`、放行 advice 檢視、量表傳視窗 |
| `src/commands/init.ts`、`README.md` | 修改 | 說明更新 |

---

### Task 1: 狀態檔記下 Codex 的 rollout 路徑

**Files:**
- Modify: `src/schema.ts:157-168`
- Modify: `src/hook/apply-event.ts:150-165`
- Test: `src/apply-hook-event.test.ts`（檔尾追加）

**Interfaces:**
- Produces: `TaskState.transcriptPath?: string`（只有 Codex 寫入，值為 hook payload 的 `transcript_path`；之後的事件沒帶 `transcript_path` 時沿用舊值）。

- [ ] **Step 1: 寫失敗的測試**

在 `src/apply-hook-event.test.ts` 檔尾追加（沿用該檔已有的 `capture()`、`applyHookEvent`、`TaskState`，不需要新增 import）：

```typescript
test("codex：transcript_path 寫進 transcriptPath，後續事件沒帶也保留", () => {
  const { written, deps } = capture();
  const codexDeps = { ...deps, agent: "codex" as const };
  applyHookEvent(
    {
      session_id: "cx3", cwd: "/work/proj", hook_event_name: "SessionStart", source: "startup",
      transcript_path: "/home/u/.codex/sessions/2026/09/19/rollout-x.jsonl",
    },
    codexDeps,
  );
  assert.equal(written[0].transcriptPath, "/home/u/.codex/sessions/2026/09/19/rollout-x.jsonl");

  applyHookEvent(
    { session_id: "cx3", cwd: "/work/proj", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } },
    codexDeps,
  );
  assert.equal(written[1].transcriptPath, "/home/u/.codex/sessions/2026/09/19/rollout-x.jsonl");
});

test("claude：不寫 transcriptPath（鍵都不出現）", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "cl3", cwd: "/work/proj", hook_event_name: "SessionStart", source: "startup",
      transcript_path: "/Users/me/.claude/projects/proj/cl3.jsonl",
    },
    deps,
  );
  assert.equal("transcriptPath" in written[0], false);
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --import tsx --test src/apply-hook-event.test.ts`
Expected: FAIL（`transcriptPath` 為 `undefined`；typecheck 之外 tsx 不會報型別錯，所以是斷言失敗）。

- [ ] **Step 3: 實作**

`src/schema.ts`，在 `claudeSessionDir` 那行下面加：

```typescript
  claudeSessionDir: z.string().optional(),
  /** Codex 的 rollout 檔路徑（hook payload 的 transcript_path）。只有 Codex 寫入；用量分析靠它 tail。 */
  transcriptPath: z.string().optional(),
```

`src/hook/apply-event.ts`，在 `persist` 的 `writeTaskState({...})` 裡，緊接 `claudeSessionDir: ... ,`（結束於 `: existing?.claudeSessionDir,`）之後加：

```typescript
        ...(deps.agent === "codex"
          ? { transcriptPath: payload.transcript_path ?? existing?.transcriptPath }
          : {}),
```

- [ ] **Step 4: 執行確認通過**

Run: `node --import tsx --test src/apply-hook-event.test.ts src/codex-hook-fixture.test.ts src/schema.test.ts`
Expected: PASS（既有測試不受影響）。

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/hook/apply-event.ts src/apply-hook-event.test.ts
git commit -m "feat: Codex 狀態檔記下 rollout 路徑 transcriptPath"
```

---

### Task 2: Codex rollout 解析器

**Files:**
- Create: `src/usage/codex-rollout.ts`
- Create: `src/fixtures/codex-0.155.1-rollout-sample.jsonl`
- Test: `src/usage/codex-rollout.test.ts`
- Modify: `src/usage/types.ts`（`ParsedUsage` 加 `contextWindow?`）

**Interfaces:**
- Consumes: `ParsedEvent`、`TailState`、`createTailState()`（`src/usage/tail-transcript.ts`）。
- Produces:
  - `ParsedUsage.contextWindow?: number`
  - `parseCodexRollout(chunk: string, state: TailState, bytesRead: number): { events: ParsedEvent[]; state: TailState }`（與 `parseNewContent` 同簽名）

對應規則（spec「語意對應」）：`cacheRead = cached_input_tokens`、`cacheCreation = max(0, input_tokens − cached_input_tokens)`、`input = 0`、`output = output_tokens`、`messageId = "total:" + total_token_usage.total_tokens`。工具輸出長度 = 所有 `text` 字串長度總和；工具名由 `call_id` 對回 `custom_tool_call`／`function_call` 的 `name`。

- [ ] **Step 1: 建立 fixture**

`src/fixtures/codex-0.155.1-rollout-sample.jsonl`（每行一個 JSON，共 9 行；第 5、6 行 `token_count` 累計值相同，是刻意的重複；第 8 行 `info` 為 null）：

```jsonl
{"timestamp":"2026-09-19T13:12:56.100Z","ordinal":0,"type":"session_meta","payload":{"id":"01a0b9cc-6aef-76c0-832b-0cc0e59358ce","cwd":"/work/proj","source":"exec"}}
{"timestamp":"2026-09-19T13:12:56.200Z","ordinal":1,"type":"event_msg","payload":{"type":"task_started","turn_id":"t1"}}
{"timestamp":"2026-09-19T13:13:00.000Z","ordinal":2,"type":"response_item","payload":{"type":"custom_tool_call","id":"ctc_1","status":"completed","call_id":"call_A","name":"exec","input":"const r = await tools.exec_command({\"cmd\":\"echo hi\"}); text(r.output);"}}
{"timestamp":"2026-09-19T13:13:01.000Z","ordinal":3,"type":"response_item","payload":{"type":"custom_tool_call_output","id":"ctco_1","call_id":"call_A","output":[{"type":"input_text","text":"Script completed\nWall time 0.1 seconds\nOutput:\n"},{"type":"input_text","text":"hi\n"}]}}
{"timestamp":"2026-09-19T13:13:02.000Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":15608,"cached_input_tokens":15104,"cache_write_input_tokens":0,"output_tokens":157,"reasoning_output_tokens":58,"total_tokens":15765},"last_token_usage":{"input_tokens":15608,"cached_input_tokens":15104,"cache_write_input_tokens":0,"output_tokens":157,"reasoning_output_tokens":58,"total_tokens":15765},"model_context_window":258400}}}
{"timestamp":"2026-09-19T13:13:02.100Z","ordinal":5,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":15608,"cached_input_tokens":15104,"cache_write_input_tokens":0,"output_tokens":157,"reasoning_output_tokens":58,"total_tokens":15765},"last_token_usage":{"input_tokens":15608,"cached_input_tokens":15104,"cache_write_input_tokens":0,"output_tokens":157,"reasoning_output_tokens":58,"total_tokens":15765},"model_context_window":258400}}}
{"timestamp":"2026-09-19T13:13:10.000Z","ordinal":6,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":32719,"cached_input_tokens":31232,"cache_write_input_tokens":0,"output_tokens":181,"reasoning_output_tokens":58,"total_tokens":32900},"last_token_usage":{"input_tokens":17111,"cached_input_tokens":16128,"cache_write_input_tokens":0,"output_tokens":24,"reasoning_output_tokens":0,"total_tokens":17135},"model_context_window":258400}}}
{"timestamp":"2026-09-19T13:13:11.000Z","ordinal":7,"type":"event_msg","payload":{"type":"token_count","info":null}}
{"timestamp":"2026-09-19T13:13:21.000Z","ordinal":8,"type":"event_msg","payload":{"type":"task_complete","turn_id":"t1","last_agent_message":"done"}}
```

- [ ] **Step 2: 寫失敗的測試**

`src/usage/codex-rollout.test.ts`：

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { accumulate } from "./accumulate.js";
import { parseCodexRollout } from "./codex-rollout.js";
import { createTailState } from "./tail-transcript.js";

const SAMPLE = readFileSync(new URL("../fixtures/codex-0.155.1-rollout-sample.jsonl", import.meta.url), "utf-8");

test("parseCodexRollout：token_count 對應成 usage（cached / 重算 / 視窗），info 為 null 的略過", () => {
  const { events } = parseCodexRollout(SAMPLE, createTailState(), Buffer.byteLength(SAMPLE));
  const usageEvents = events.filter((e) => e.usage);
  assert.equal(usageEvents.length, 3); // 第 5、6 行重複各算一筆（去重在 accumulate），第 8 行 info=null 略過
  assert.deepEqual(usageEvents[0].usage, {
    input: 0,
    cacheRead: 15104,
    cacheCreation: 504,
    output: 157,
    contextWindow: 258400,
  });
  assert.equal(usageEvents[0].messageId, "total:15765");
  assert.equal(usageEvents[2].messageId, "total:32900");
  assert.deepEqual(usageEvents[2].usage, {
    input: 0,
    cacheRead: 16128,
    cacheCreation: 983,
    output: 24,
    contextWindow: 258400,
  });
  assert.equal(usageEvents[0].timestamp, "2026-09-19T13:13:02.000Z");
  assert.equal(usageEvents[0].isSidechain, false);
});

test("parseCodexRollout：custom_tool_call_output 的 text 長度，工具名由 call_id 對回", () => {
  const { events } = parseCodexRollout(SAMPLE, createTailState(), Buffer.byteLength(SAMPLE));
  const results = events.filter((e) => e.toolResultChars);
  assert.equal(results.length, 1);
  assert.equal(results[0].toolResultChars?.toolName, "exec");
  assert.equal(
    results[0].toolResultChars?.chars,
    "Script completed\nWall time 0.1 seconds\nOutput:\n".length + "hi\n".length,
  );
});

test("parseCodexRollout + accumulate：重複的 token_count 只算一次", () => {
  const { events } = parseCodexRollout(SAMPLE, createTailState(), Buffer.byteLength(SAMPLE));
  const { next } = accumulate({ ...emptyStats() }, events);
  assert.equal(next.mainThreadMsgCount, 2);
  assert.equal(next.lastOccupiedTokens, 17111);
  assert.equal(next.lastContextWindow, 258400);
  assert.equal(next.lastCacheRead, 16128);
  assert.equal(next.lastCacheCreation, 983);
});

test("parseCodexRollout：壞行、非物件、缺欄位都略過，不丟例外", () => {
  const chunk = [
    "not json",
    "123",
    JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } }),
    JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "x" } }),
    "",
  ].join("\n");
  const { events } = parseCodexRollout(chunk, createTailState(), Buffer.byteLength(chunk));
  assert.equal(events.filter((e) => e.usage).length, 0);
  // 沒有對應 call 的輸出仍會記一筆（長度 0、工具名未知），不影響後續
  assert.equal(events.filter((e) => e.toolResultChars).length, 1);
  assert.equal(events.find((e) => e.toolResultChars)?.toolResultChars?.chars, 0);
});

test("parseCodexRollout：跨 chunk 的半行接到下一次讀，offset 依 bytesRead 推進", () => {
  const lines = SAMPLE.trimEnd().split("\n");
  const cut = lines[4].length - 10;
  const first = lines.slice(0, 4).join("\n") + "\n" + lines[4].slice(0, cut);
  const second = lines[4].slice(cut) + "\n" + lines.slice(5).join("\n") + "\n";
  const r1 = parseCodexRollout(first, createTailState(), Buffer.byteLength(first));
  assert.equal(r1.events.filter((e) => e.usage).length, 0);
  assert.equal(r1.state.offset, Buffer.byteLength(first));
  const r2 = parseCodexRollout(second, r1.state, Buffer.byteLength(second));
  assert.equal(r2.events.filter((e) => e.usage).length, 3);
  assert.equal(r2.state.offset, Buffer.byteLength(first) + Buffer.byteLength(second));
});

test("parseCodexRollout：function_call / function_call_output（字串輸出）也算工具結果", () => {
  const chunk = [
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" } }),
    JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "abcde" } }),
    "",
  ].join("\n");
  const { events } = parseCodexRollout(chunk, createTailState(), Buffer.byteLength(chunk));
  assert.equal(events[0].toolResultChars?.toolName, "shell");
  assert.equal(events[0].toolResultChars?.chars, 5);
});

function emptyStats() {
  return {
    sessionId: "cx",
    mainThreadMsgCount: 0,
    sessionStartedAt: undefined,
    lastMsgAt: undefined,
    cacheCreationTotal: 0,
    cacheCreationRollingAvg: 0,
    recentMessageIds: [],
  };
}
```

- [ ] **Step 3: 執行確認失敗**

Run: `node --import tsx --test src/usage/codex-rollout.test.ts`
Expected: FAIL，`Cannot find module './codex-rollout.js'`。

- [ ] **Step 4: 實作**

`src/usage/types.ts`：在 `ParsedUsage` 加欄位（其他不動）：

```typescript
export interface ParsedUsage {
  cacheCreation: number;
  cacheRead: number;
  output: number;
  input: number;
  /** Codex 才有：這次呼叫時模型的 context 視窗大小（rollout 的 model_context_window）。 */
  contextWindow?: number;
}
```

新增 `src/usage/codex-rollout.ts`：

```typescript
import { ParsedEvent, TailState } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 輸出可能是字串，或 `[{ type: "input_text", text }]` 陣列；只算 text 字元數。 */
function outputTextLength(output: unknown): number {
  if (typeof output === "string") return output.length;
  if (!Array.isArray(output)) return 0;
  let total = 0;
  for (const block of output) {
    if (isRecord(block) && typeof block.text === "string") total += block.text.length;
  }
  return total;
}

/**
 * 解析 Codex rollout jsonl 的新內容，介面與 parseNewContent 相同（bytesRead 必須是 fs 層實際讀到的位元組數）。
 *
 * usage 對應：cacheRead = cached_input_tokens；cacheCreation = input_tokens − cached_input_tokens
 * （Codex 沒有 cache 寫入，「沒命中的部分」是最接近的替代）；input 固定 0，所以佔用量 = input_tokens。
 * messageId 用累計的 total_tokens，讓重複的 token_count 行在 accumulate 被去重。
 */
export function parseCodexRollout(
  chunk: string,
  state: TailState,
  bytesRead: number,
): { events: ParsedEvent[]; state: TailState } {
  const combined = state.danglingLine + chunk;
  const lines = combined.split("\n");
  const danglingLine = lines.pop() ?? "";
  const toolUseNameById = new Map(state.toolUseNameById);
  const events: ParsedEvent[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const payload = parsed.payload;
    if (!isRecord(payload)) continue;
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;

    if (parsed.type === "response_item") {
      if (
        (payload.type === "custom_tool_call" || payload.type === "function_call") &&
        typeof payload.call_id === "string" &&
        typeof payload.name === "string"
      ) {
        toolUseNameById.set(payload.call_id, { name: payload.name });
        continue;
      }
      if (payload.type === "custom_tool_call_output" || payload.type === "function_call_output") {
        const toolUseId = typeof payload.call_id === "string" ? payload.call_id : undefined;
        const ref = toolUseId ? toolUseNameById.get(toolUseId) : undefined;
        events.push({
          messageId: undefined,
          isSidechain: false,
          timestamp,
          usage: undefined,
          toolResultChars: { toolName: ref?.name, chars: outputTextLength(payload.output), toolUseId },
        });
      }
      continue;
    }

    if (parsed.type === "event_msg" && payload.type === "token_count") {
      const info = payload.info;
      if (!isRecord(info)) continue;
      const last = info.last_token_usage;
      if (!isRecord(last)) continue;
      const total = info.total_token_usage;
      const totalTokens = isRecord(total) && typeof total.total_tokens === "number" ? total.total_tokens : undefined;
      const input = numberOr0(last.input_tokens);
      const cached = numberOr0(last.cached_input_tokens);
      const contextWindow = typeof info.model_context_window === "number" ? info.model_context_window : undefined;
      events.push({
        messageId: totalTokens !== undefined ? `total:${totalTokens}` : undefined,
        isSidechain: false,
        timestamp,
        usage: {
          input: 0,
          cacheRead: cached,
          cacheCreation: Math.max(0, input - cached),
          output: numberOr0(last.output_tokens),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        },
        toolResultChars: undefined,
      });
    }
  }

  return {
    events,
    state: { offset: state.offset + bytesRead, toolUseNameById, danglingLine },
  };
}
```

- [ ] **Step 5: 執行確認通過**

`accumulate` 目前還沒記 `lastContextWindow`（Task 3 才做），所以第三個測試的 `next.lastContextWindow` 斷言此時會失敗，其餘應通過：

Run: `node --import tsx --test src/usage/codex-rollout.test.ts`
Expected: 除「重複的 token_count 只算一次」裡的 `lastContextWindow` 斷言外全部 PASS。**先把該測試的 `assert.equal(next.lastContextWindow, 258400);` 一行暫時保留**，Task 3 完成後整檔轉綠。

- [ ] **Step 6: Commit**

```bash
git add src/usage/types.ts src/usage/codex-rollout.ts src/usage/codex-rollout.test.ts src/fixtures/codex-0.155.1-rollout-sample.jsonl
git commit -m "feat: Codex rollout 解析器，token_count 轉成既有 ParsedEvent"
```

---

### Task 3: context 視窗貫穿統計與量表函式

**Files:**
- Modify: `src/usage/types.ts`（`SessionUsageStats`、`createSessionUsageStats`）
- Modify: `src/usage/accumulate.ts`
- Modify: `src/context-snapshot.ts`
- Modify: `docs/superpowers/specs/2026-09-19-codex-usage-design.md`（一句話修正，見 Step 6）
- Test: `src/usage/accumulate.test.ts`、`src/context-snapshot.test.ts`（各追加測試）

**Interfaces:**
- Consumes: `ParsedUsage.contextWindow?`（Task 2）。
- Produces:
  - `SessionUsageStats.agent?: Agent`、`SessionUsageStats.lastContextWindow?: number`
  - `createSessionUsageStats(sessionId: string, agent: Agent = "claude"): SessionUsageStats`（只有 codex 才會帶 `agent` 鍵）
  - `contextOccupancyPct(lastOccupiedTokens: number, contextWindow?: number): number`
  - `formatContextGaugeBar(lastOccupiedTokens: number | undefined, contextWindow?: number)`
  - `formatOccupiedTokensLine(lastOccupiedTokens: number | undefined, contextWindow?: number): string`
  - `formatLastTurnBreakdownLine(usage: LastTurnUsage | undefined, agent?: Agent): string | undefined`

- [ ] **Step 1: 寫失敗的測試**

追加到 `src/context-snapshot.test.ts`（import 區已有 `contextOccupancyPct` 等，另外補 `formatLastTurnBreakdownLine` 已在）：

```typescript
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
```

追加到 `src/usage/accumulate.test.ts`（檔頭已 import `accumulate`、`createSessionUsageStats`；若沒有就補，先看 `sed -n 1,12p src/usage/accumulate.test.ts`）：

```typescript
test("accumulate：usage 帶 contextWindow 時記成 lastContextWindow；沒帶就不出現這個鍵", () => {
  const stats0 = createSessionUsageStats("s1");
  const withWindow = accumulate(stats0, [
    { messageId: "a", isSidechain: false, timestamp: "t", usage: { input: 0, cacheRead: 1, cacheCreation: 2, output: 3, contextWindow: 258400 }, toolResultChars: undefined },
  ]);
  assert.equal(withWindow.next.lastContextWindow, 258400);

  const without = accumulate(stats0, [
    { messageId: "b", isSidechain: false, timestamp: "t", usage: { input: 0, cacheRead: 1, cacheCreation: 2, output: 3 }, toolResultChars: undefined },
  ]);
  assert.equal("lastContextWindow" in without.next, false);
});

test("createSessionUsageStats：只有 codex 才帶 agent 鍵", () => {
  assert.equal("agent" in createSessionUsageStats("s1"), false);
  assert.equal(createSessionUsageStats("s1", "codex").agent, "codex");
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --import tsx --test src/context-snapshot.test.ts src/usage/accumulate.test.ts`
Expected: FAIL（`lastContextWindow` 未定義、`agent` 不存在、Codex 明細字串不符）。

- [ ] **Step 3: 實作 types 與 accumulate**

`src/usage/types.ts` 檔頭加 `import type { Agent } from "../agent.js";`，`SessionUsageStats` 加兩個欄位，`createSessionUsageStats` 改成：

```typescript
export interface SessionUsageStats {
  // ...既有欄位不動...
  /** 主線 Read 各 path 次數（供 repeated-read） */
  readPathCounts?: Record<string, number>;
  /** 只有 Codex 才會設定；detect 依它切換建議文案。缺省視為 claude。 */
  agent?: Agent;
  /** 最近一次呼叫的模型 context 視窗（Codex 由 rollout 帶入；缺省時量表用 Claude 的 1,000,000）。 */
  lastContextWindow?: number;
}

export function createSessionUsageStats(sessionId: string, agent: Agent = "claude"): SessionUsageStats {
  return {
    sessionId,
    mainThreadMsgCount: 0,
    sessionStartedAt: undefined,
    lastMsgAt: undefined,
    cacheCreationTotal: 0,
    cacheCreationRollingAvg: 0,
    recentMessageIds: [],
    readPathCounts: {},
    ...(agent === "codex" ? { agent } : {}),
  };
}
```

`src/usage/accumulate.ts`，在 `stats = { ...stats, mainThreadMsgCount, ... lastInput: event.usage.input, }` 的最後一個屬性 `lastInput` 後面加：

```typescript
      lastInput: event.usage.input,
      ...(event.usage.contextWindow !== undefined ? { lastContextWindow: event.usage.contextWindow } : {}),
```

- [ ] **Step 4: 實作 context-snapshot**

`src/context-snapshot.ts` 檔頭加 `import type { Agent } from "./agent.js";`，並把四個函式改成：

```typescript
export function contextOccupancyPct(
  lastOccupiedTokens: number,
  contextWindow: number = CONTEXT_WINDOW_TOKENS,
): number {
  return Math.round((lastOccupiedTokens / contextWindow) * 100);
}

export function formatContextGaugeBar(
  lastOccupiedTokens: number | undefined,
  contextWindow?: number,
): { bar: string; color: "green" | "yellow" | "red" } | undefined {
  if (lastOccupiedTokens === undefined) return undefined;
  const pct = contextOccupancyPct(lastOccupiedTokens, contextWindow);
  const filled = Math.min(GAUGE_WIDTH, Math.max(0, Math.round((pct / 100) * GAUGE_WIDTH)));
  const bar = `${"█".repeat(filled)}${"░".repeat(GAUGE_WIDTH - filled)}`;
  const color = pct >= 95 ? "red" : pct >= 80 ? "yellow" : "green";
  return { bar, color };
}

export function formatOccupiedTokensLine(lastOccupiedTokens: number | undefined, contextWindow?: number): string {
  if (lastOccupiedTokens === undefined) return "還沒有用量資料";
  const pct = contextOccupancyPct(lastOccupiedTokens, contextWindow);
  return `窗口約 ${lastOccupiedTokens.toLocaleString("en-US")} token（約 ${pct}%）`;
}

export function formatLastTurnBreakdownLine(usage: LastTurnUsage | undefined, agent: Agent = "claude"): string | undefined {
  if (!usage) return undefined;
  if (agent === "codex") {
    return `上一輪 cached ${usage.cacheRead.toLocaleString("en-US")} · 新算 ${usage.cacheCreation.toLocaleString("en-US")}`;
  }
  return `上一輪 cache read ${usage.cacheRead.toLocaleString("en-US")} · cache create ${usage.cacheCreation.toLocaleString("en-US")} · input ${usage.input.toLocaleString("en-US")}`;
}
```

- [ ] **Step 5: 執行確認通過**

Run: `node --import tsx --test src/context-snapshot.test.ts src/usage/accumulate.test.ts src/usage/codex-rollout.test.ts && pnpm typecheck`
Expected: 全部 PASS（`codex-rollout.test.ts` 的 `lastContextWindow` 斷言此時也轉綠）；typecheck 無錯。

- [ ] **Step 6: 修正 spec 一句話並 Commit**

spec 原寫 Codex 明細為 `cached {n} · 新算 {n} · 輸出 {n}`，實作時發現 `LastTurnUsage` 沒有 output 欄位、為此新增統計欄位不值得（YAGNI），定案為 `cached {n} · 新算 {n}`。編輯 `docs/superpowers/specs/2026-09-19-codex-usage-design.md`，把該行改成：

```
  - 上一輪明細標籤依來源切換：Claude 維持 `cache read · cache create · input`，Codex 顯示
    `cached {n} · 新算 {n}`（`cacheRead` → cached，`cacheCreation` → 新算；`input` 恆為 0、`output` 不在明細內）。
```

```bash
git add src/usage/types.ts src/usage/accumulate.ts src/usage/accumulate.test.ts src/context-snapshot.ts src/context-snapshot.test.ts docs/superpowers/specs/2026-09-19-codex-usage-design.md
git commit -m "feat: context 視窗隨統計帶入，量表與上一輪明細支援 Codex"
```

---

### Task 4: 建議文案依來源切換

**Files:**
- Modify: `src/usage/detect.ts`
- Test: `src/usage/detect.test.ts`（追加）

**Interfaces:**
- Consumes: `SessionUsageStats.agent`、`SessionUsageStats.lastContextWindow`、`contextOccupancyPct(tokens, window?)`（Task 3）。
- Produces: `detect()` 簽名不變；`stats.agent === "codex"` 時訊息改為 Codex 版（見下）。

文案（spec「建議文案」）：

| kind | Codex 訊息 |
|---|---|
| `long-session` | `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再另開新 session（這個 session 已經 {N} 則訊息、開了 {M} 分鐘）。` |
| `cache-spike` | `這一輪重算了 {X} token（平常 {Y}），可能是閒置太久 cache 過期或 context 被改動；長時間離開後建議另開新 session。` |
| `heavy-baseline` | `開場偏重（第一輪就吃了 {X} token）；檢查 AGENTS.md、啟用的 MCP／plugin 與 skill 有沒有太多。` |
| `fat-tool-result` | `重跑剛剛那個 {tool} 呼叫，加上 head/grep 把輸出縮小（原本回傳約 {T} token，約占 context window {P}%）。` |

- [ ] **Step 1: 寫失敗的測試**

追加到 `src/usage/detect.test.ts`（檔內已有 `usageEvent`、`toolResultEvent` helper 與 `accumulate`、`detect`、`createSessionUsageStats` import）：

```typescript
test("detect：Codex 的 long-session 不提 /clear，改說另開新 session", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const events = Array.from({ length: 201 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "long-session")[0].message;
  assert.match(msg, /另開新 session/);
  assert.match(msg, /docs\/superpowers\/plans\//);
  assert.doesNotMatch(msg, /\/clear/);
});

test("detect：Codex 的 cache-spike 說可能是閒置過期，不怪 MCP 設定", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const events = [
    ...Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 100, "t")),
    usageEvent("spike", 50000, "t"),
  ];
  const { next, steps } = accumulate(stats0, events);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "cache-spike")[0].message;
  assert.match(msg, /閒置太久 cache 過期/);
  assert.match(msg, /50,000/);
  assert.doesNotMatch(msg, /MCP 設定/);
});

test("detect：Codex 的 heavy-baseline 不提 inspect", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const { next, steps } = accumulate(stats0, [usageEvent("m0", 60001, "t")]);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "heavy-baseline")[0].message;
  assert.match(msg, /開場偏重/);
  assert.doesNotMatch(msg, /inspect/);
});

test("detect：Codex 的 fat-tool-result 用 Codex 文案，佔用率用該 session 的視窗", () => {
  const stats0 = createSessionUsageStats("cx", "codex");
  const usage: ParsedEvent = {
    messageId: "u1",
    isSidechain: false,
    timestamp: "t",
    usage: { input: 0, cacheRead: 0, cacheCreation: 10, output: 0, contextWindow: 100_000 },
    toolResultChars: undefined,
  };
  // 40,000 字元 ≈ 10,000 token（>8000 門檻）；視窗 100,000 → 10%
  const { next, steps } = accumulate(stats0, [usage, toolResultEvent("exec", 40_000, "t")]);
  const msg = detect(stats0, next, steps).filter((a) => a.kind === "fat-tool-result")[0].message;
  assert.match(msg, /exec/);
  assert.match(msg, /head\/grep/);
  assert.match(msg, /約占 context window 10%/);
  assert.doesNotMatch(msg, /offset\/limit/);
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --import tsx --test src/usage/detect.test.ts`
Expected: 新增的 4 個測試 FAIL（文案仍是 Claude 版），既有測試 PASS。

- [ ] **Step 3: 實作**

`src/usage/detect.ts`：加一個小 helper 並改四個檢查函式。

在 `estimateTokensFromChars` 下面加：

```typescript
function isCodex(stats: SessionUsageStats): boolean {
  return stats.agent === "codex";
}
```

`checkLongSession` 的 `message` 改為：

```typescript
      message: isCodex(after)
        ? `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再另開新 session（這個 session 已經 ${after.mainThreadMsgCount.toLocaleString("en-US")} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`
        : `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再執行 /clear 或另開新 session（這個 session 已經 ${after.mainThreadMsgCount.toLocaleString("en-US")} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`,
```

`checkCacheSpike` 的 `message` 改為：

```typescript
      message: isCodex(before)
        ? `這一輪重算了 ${usage.cacheCreation.toLocaleString("en-US")} token（平常 ${Math.round(before.cacheCreationRollingAvg).toLocaleString("en-US")}），可能是閒置太久 cache 過期或 context 被改動；長時間離開後建議另開新 session。`
        : `現在 /clear 或開新 session，別在這個 session 裡繼續換工具/MCP 設定（剛剛這一輪因此重算了 ${usage.cacheCreation.toLocaleString("en-US")} token，平常只要 ${Math.round(before.cacheCreationRollingAvg).toLocaleString("en-US")}）。`,
```

`checkHeavyBaseline` 的 `message` 改為：

```typescript
      message: isCodex(before)
        ? `開場偏重（第一輪就吃了 ${usage.cacheCreation.toLocaleString("en-US")} token）；檢查 AGENTS.md、啟用的 MCP／plugin 與 skill 有沒有太多。`
        : `開場偏重（第一輪就吃了 ${usage.cacheCreation.toLocaleString("en-US")} token）；下方是可能來源，也可執行 task-tracker inspect 細看。`,
```

`checkFatToolResult`：`const pct = contextOccupancyPct(estTokens);` 改成 `const pct = contextOccupancyPct(estTokens, stats.lastContextWindow);`；子 agent 分支不動；最後一個 `return [...]`（一般工具）的 `message` 改為：

```typescript
      message: isCodex(stats)
        ? `重跑剛剛那個 ${tool} 呼叫，加上 head/grep 把輸出縮小（原本回傳約 ${tokens} token，約占 context window ${pct}%）。`
        : `重跑剛剛那個 ${tool} 呼叫${pathPart}，加上 head/grep/limit 或 Read 的 offset/limit 把輸出縮小（原本回傳約 ${tokens} token，約占 context window ${pct}%）。`,
```

- [ ] **Step 4: 執行確認通過**

Run: `node --import tsx --test src/usage/detect.test.ts && pnpm typecheck`
Expected: 全部 PASS（含既有 Claude 文案測試）。

- [ ] **Step 5: Commit**

```bash
git add src/usage/detect.ts src/usage/detect.test.ts
git commit -m "feat: 用量建議文案依來源切換，Codex 不再提 /clear 與 MCP 設定"
```

---

### Task 5: tail-runtime 依 agent 選解析器，並統一「要 tail 哪個檔」

**Files:**
- Modify: `src/usage/tail-runtime.ts`
- Create: `src/usage/transcript-source.ts`
- Test: `src/usage/transcript-source.test.ts`（新增）、`src/usage/pipeline.test.ts`（追加）

**Interfaces:**
- Consumes: `parseCodexRollout`（Task 2）、`createSessionUsageStats(id, agent)`（Task 3）、`TaskState.transcriptPath`（Task 1）、`resolveTranscriptPath`（`src/workflow/paths.ts`）。
- Produces:
  - `prime(sessionId: string, transcriptPath: string, agent?: Agent)`、`refresh(sessionId: string, transcriptPath: string, agent?: Agent)`（`agent` 預設 `"claude"`）
  - `transcriptSource(state: TaskState | null | undefined): { agent: Agent; path: string } | undefined`

- [ ] **Step 1: 寫失敗的測試**

`src/usage/transcript-source.test.ts`：

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { transcriptSource } from "./transcript-source.js";

const base = { sessionId: "s1", updatedAt: "2026-09-19T00:00:00.000Z" };

test("transcriptSource：沒有狀態或沒有路徑就回 undefined", () => {
  assert.equal(transcriptSource(null), undefined);
  assert.equal(transcriptSource(undefined), undefined);
  assert.equal(transcriptSource({ ...base }), undefined);
  assert.equal(transcriptSource({ ...base, agent: "codex" }), undefined);
});

test("transcriptSource：codex 用 transcriptPath", () => {
  assert.deepEqual(transcriptSource({ ...base, agent: "codex", transcriptPath: "/r/rollout.jsonl" }), {
    agent: "codex",
    path: "/r/rollout.jsonl",
  });
});

test("transcriptSource：claude 由 claudeSessionDir 推出 transcript 路徑", () => {
  const source = transcriptSource({ ...base, claudeSessionDir: "/nonexistent/proj" });
  assert.equal(source?.agent, "claude");
  assert.equal(source?.path, "/nonexistent/proj/s1.jsonl");
});
```

追加到 `src/usage/pipeline.test.ts`（檔頭已有 `mkdtempSync`、`rmSync`、`writeFileSync`、`tmpdir`、`join`、`forget`、`prime`、`adviceForSession`；另外 import `refresh`：把檔頭 `import { forget, prime } from "./tail-runtime.js";` 改成 `import { forget, peek, prime, refresh } from "./tail-runtime.js";`）：

```typescript
function codexTokenLine(total: number, input: number, cached: number): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 1 },
        model_context_window: 258400,
      },
    },
  });
}

test("Codex：prime／refresh 用 Codex 解析器，advice 為 Codex 文案，統計帶視窗", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-codex-"));
  const path = join(dir, "rollout.jsonl");
  const sessionId = `codex-pipeline-${Date.now()}`;
  try {
    writeFileSync(path, codexTokenLine(60001, 60001, 0) + "\n"); // 第一輪 60001 個沒命中 → heavy-baseline
    const primed = prime(sessionId, path, "codex");
    const heavy = primed.advice.filter((a) => a.kind === "heavy-baseline");
    assert.equal(heavy.length, 1);
    assert.match(heavy[0].message, /開場偏重/);
    assert.doesNotMatch(heavy[0].message, /inspect/);
    assert.equal(peek(sessionId)?.lastContextWindow, 258400);
    assert.equal(peek(sessionId)?.lastOccupiedTokens, 60001);

    writeFileSync(path, codexTokenLine(60001, 60001, 0) + "\n" + codexTokenLine(80000, 20000, 19000) + "\n");
    refresh(sessionId, path, "codex");
    assert.equal(peek(sessionId)?.mainThreadMsgCount, 2);
    assert.equal(peek(sessionId)?.lastOccupiedTokens, 20000);
    assert.equal(peek(sessionId)?.lastCacheRead, 19000);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --import tsx --test src/usage/transcript-source.test.ts src/usage/pipeline.test.ts`
Expected: FAIL（`transcript-source.js` 不存在；`prime` 不接受 agent，會用 Claude 解析器而抓不到 usage）。

- [ ] **Step 3: 實作**

新增 `src/usage/transcript-source.ts`：

```typescript
import { agentOf, type Agent } from "../agent.js";
import type { TaskState } from "../schema.js";
import { resolveTranscriptPath } from "../workflow/paths.js";

/**
 * 由狀態檔決定用量分析要 tail 哪個檔、用哪種解析器。
 * Claude：claudeSessionDir 推出 transcript；Codex：hook 寫下的 transcriptPath（rollout 檔）。
 * 任一來源缺路徑就回 undefined（尚未納入分析）。
 */
export function transcriptSource(
  state: TaskState | null | undefined,
): { agent: Agent; path: string } | undefined {
  if (!state) return undefined;
  const agent = agentOf(state);
  if (agent === "codex") {
    return state.transcriptPath ? { agent, path: state.transcriptPath } : undefined;
  }
  return state.claudeSessionDir
    ? { agent, path: resolveTranscriptPath(state.claudeSessionDir, state.sessionId) }
    : undefined;
}
```

`src/usage/tail-runtime.ts`：

檔頭 import 區加（保留既有的）：

```typescript
import type { Agent } from "../agent.js";
import { parseCodexRollout } from "./codex-rollout.js";
```

把 `runOnce` 改成多收一個 `agent` 參數並選解析器：

```typescript
function runOnce(
  prevTailState: TailState,
  prevStats: SessionUsageStats,
  prevSubagents: SubagentsState,
  content: string,
  bytesRead: number,
  agent: Agent,
): { tailState: TailState; stats: SessionUsageStats; subagents: SubagentsState; advice: Advice[] } {
  const parse = agent === "codex" ? parseCodexRollout : parseNewContent;
  const parsed = parse(content, prevTailState, bytesRead);
  const { next, steps } = accumulate(prevStats, parsed.events);
  const advice = detect(prevStats, next, steps);
  const subagents = applySubagentEvents(prevSubagents, parsed.events);
  return { tailState: parsed.state, stats: next, subagents, advice };
}
```

`prime` 與 `refresh` 簽名與呼叫改為：

```typescript
export function prime(
  sessionId: string,
  transcriptPath: string,
  agent: Agent = "claude",
): { stats: SessionUsageStats; advice: Advice[] } {
  const stats0 = createSessionUsageStats(sessionId, agent);
  // ...其餘不動，唯一差別：runOnce(createTailState(), stats0, subagents0, content, bytesRead, agent)
}

export function refresh(sessionId: string, transcriptPath: string, agent: Agent = "claude"): Advice[] {
  const entry = sessions.get(sessionId);
  if (!entry) return prime(sessionId, transcriptPath, agent).advice;
  // ...其餘不動，差別兩處：
  //   size < offset 時 return prime(sessionId, transcriptPath, agent).advice;
  //   runOnce(entry.tailState, entry.stats, entry.subagents, content, bytesRead, agent)
}
```

- [ ] **Step 4: 執行確認通過**

Run: `node --import tsx --test src/usage/*.test.ts && pnpm typecheck`
Expected: 全部 PASS（`tail-runtime.test.ts` 既有測試不傳 agent，走預設 claude）。

- [ ] **Step 5: Commit**

```bash
git add src/usage/tail-runtime.ts src/usage/transcript-source.ts src/usage/transcript-source.test.ts src/usage/pipeline.test.ts
git commit -m "feat: tail-runtime 依 agent 選解析器，新增 transcriptSource"
```

---

### Task 6: watch 畫面接上、說明文件更新、實機驗證

**Files:**
- Modify: `src/ui/App.tsx`（watcher 約 L505-550、advice 檢視約 L751-757、兩處量表約 L723-724 與 L904-908）
- Modify: `src/commands/init.ts`（`codexNotes`）
- Modify: `README.md`

**Interfaces:**
- Consumes: `transcriptSource`、`prime`／`refresh` 的 `agent` 參數、`formatContextGaugeBar`／`formatOccupiedTokensLine`／`formatLastTurnBreakdownLine` 的新參數。
- Produces: 使用者可見行為（無新對外函式）。

App.tsx 是 UI 大檔，沒有元件測試；本 task 以 typecheck + 既有測試 + 實機驗證把關，可測邏輯都已在前面 task 覆蓋。

- [ ] **Step 1: watcher 改用 `transcriptSource`**

`src/ui/App.tsx`：檔頭 import 區加 `import { transcriptSource } from "../usage/transcript-source.js";`。在 transcript watcher 的 `for (const sessionId of sessionIds)` 迴圈裡，把

```typescript
      const state = readTaskState(sessionId);
      if (!state?.claudeSessionDir) continue;
      const transcriptPath = resolveTranscriptPath(state.claudeSessionDir, sessionId);

      try {
        applyAdvice(prime(sessionId, transcriptPath).advice);
```

換成

```typescript
      const source = transcriptSource(readTaskState(sessionId));
      if (!source) continue;
      const { agent, path: transcriptPath } = source;

      try {
        applyAdvice(prime(sessionId, transcriptPath, agent).advice);
```

並把同一段裡 `applyAdvice(refresh(sessionId, transcriptPath));` 改成 `applyAdvice(refresh(sessionId, transcriptPath, agent));`。

若 `resolveTranscriptPath` 在 `App.tsx` 已無其他使用（`grep -n resolveTranscriptPath src/ui/App.tsx`），移除它的 import，避免 typecheck 的未使用警告。

- [ ] **Step 2: 放行 advice 檢視**

把 advice 檢視的

```typescript
    const uncoveredHint =
      selectedSessionId && agentOf(readTaskState(selectedSessionId)) === "codex"
        ? CODEX_UNSUPPORTED_NOTICE
        : selectedSessionId && !readTaskState(selectedSessionId)?.claudeSessionDir
          ? "這個 session 還沒有 transcript 路徑，尚未納入分析"
          : undefined;
```

換成

```typescript
    const uncoveredHint =
      selectedSessionId && !transcriptSource(readTaskState(selectedSessionId))
        ? "這個 session 還沒有 transcript 路徑，尚未納入分析"
        : undefined;
```

**不要動** cache 檢視與 tools 檢視的 Codex 分支（維持「尚未支援」，spec 明定）。

- [ ] **Step 3: 量表傳入視窗與來源**

split 檢視兩行改成：

```typescript
        leftGauge={formatContextGaugeBar(leftUsage?.lastOccupiedTokens, leftUsage?.lastContextWindow)}
        rightGauge={formatContextGaugeBar(rightUsage?.lastOccupiedTokens, rightUsage?.lastContextWindow)}
```

單一 session 的 `contextSnapshot` 改成：

```typescript
  const contextSnapshot = {
    occupiedLine: formatOccupiedTokensLine(usage?.lastOccupiedTokens, usage?.lastContextWindow),
    breakdownLine: formatLastTurnBreakdownLine(lastTurn, agentOf(taskState)),
    gauge: formatContextGaugeBar(usage?.lastOccupiedTokens, usage?.lastContextWindow),
  };
```

- [ ] **Step 4: 說明文字**

`src/commands/init.ts` 的 `codexNotes()` 中，把最後一行

```typescript
    "已用 Codex 0.155.1 測試；目前只支援活動句，任務清單、用量、inspect 尚未支援 Codex。",
```

換成

```typescript
    "已用 Codex 0.155.1 測試；目前支援活動句與用量／cache 建議，任務清單、inspect 尚未支援 Codex。",
    "session 要送出第一個 prompt 才會出現在 watch。",
```

`README.md`：
- 〈運作原理〉第 4 點（約 L35）「Codex 只有活動句，沒有 task 清單、用量與 workflow」改成「Codex 有活動句與用量／cache 建議，沒有 task 清單與 workflow」。
- 〈Codex 支援〉「只支援活動句」那條（約 L190-193）改成：

```markdown
- **支援活動句與用量／cache 建議**：`watch` 會顯示目前在做什麼（`Bash`、`apply_patch`），並從 Codex 的 rollout 檔
  （狀態檔的 `transcriptPath`）分析 token 用量：`a` 列出長 session、cache 暴增（沒命中 cache 而重算的 token 突然變多）、
  過肥的工具輸出、開場偏重四種建議，畫面也會顯示 context 佔用量表（用 Codex 回報的視窗大小）。
  **不支援**：重複讀檔建議、工具清單（`t`）、任務清單、`inspect`、workflow
  （Codex 0.155.1 沒有 `update_plan` 工具，任務清單來源尚未定案）。在 Codex session 內按 `t`／`c` 會顯示「Codex session 尚未支援此檢視」。
```

- 「Codex 只在啟動時讀取 hooks」那條（PR #36 加的）後面補一句：`且 session 要送出第一個 prompt 之後才會出現在 watch。`
- 〈待辦〉區（約 L279-281）若有「用 Codex 做端到端驗證」的條目，不動。

- [ ] **Step 5: 全量驗證**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 無錯；測試全數通過（原本 351 個 + 本計畫新增的測試）。

- [ ] **Step 6: 實機驗證（需要使用者的 Codex）**

1. `pnpm build`，然後在使用者環境用新版：`node dist/cli.js watch`（或 `pnpm dev`）。
2. 開一個**新的** Codex session（hook 只在啟動時載入），送出一個會跑指令的 prompt，例如「執行 `echo hi`」。
3. 在 `watch` 切到 Codex 分頁，選該 session：畫面應出現 context 量表與「窗口約 N token（約 X%）」（X 以 258,400 為分母），上一輪明細為 `上一輪 cached … · 新算 …`。
4. 按 `a`：不再出現「Codex session 尚未支援此檢視」；有觸發時會列出 Codex 版文案。
5. 按 `t`、`c`：仍顯示「Codex session 尚未支援此檢視」（預期行為）。
6. 同時開一個 Claude session，確認它的量表、明細與建議文案和以前一樣。

- [ ] **Step 7: Commit**

```bash
git add src/ui/App.tsx src/commands/init.ts README.md
git commit -m "feat: watch 接上 Codex 用量分析，更新 init 提示與 README"
```

---

## 完成後

- 開 PR（base `main`），描述附上實機驗證結果；不升版本號（依 AGENTS.md，發版另做）。
- 下一個子專案：「等你（核可提示）」—— 用 Codex 的 `PermissionRequest` hook，另寫 spec。
