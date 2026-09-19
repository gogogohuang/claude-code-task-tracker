# Codex 用量／cache 建議設計

日期：2026-09-19　狀態：設計已與使用者確認，待審 spec 後進入實作計畫

## 問題

Codex session 在 `watch` 只有活動句；用量、cache 建議、context 量表都對 Codex 顯示「Codex session 尚未支援此檢視」
（`src/ui/App.tsx`）。使用者希望 Codex 和 Claude Code 有一樣的功能，依序為：**用量／cache 建議 → 等你（核可提示）→ 任務清單**。
本文件只處理第一項。`inspect` 與 Workflow 不在整個系列範圍內。

## 結論

可行且改動小：Codex 的 rollout jsonl（hook payload 的 `transcript_path`）帶有每次模型呼叫的 token 用量，
只要新增一個 Codex 解析器把它轉成現有的 `ParsedEvent`，`accumulate`／`detect`／`tail-runtime` 即可重用。

Codex rollout 實測事實（Codex 0.155.1）：

- `event_msg/token_count.info.last_token_usage` 有 `input_tokens`、`cached_input_tokens`、`output_tokens`、
  `reasoning_output_tokens`；`total_token_usage` 是累計值；`model_context_window` 為 258400。
  `cache_write_input_tokens` 恆為 0，不能當 cache creation。
- 工具呼叫都是 `custom_tool_call`（`name` 為 `exec`，`input` 是 JS 字串）與 `custom_tool_call_output`
  （`output` 是 `input_text` 陣列），以 `call_id` 配對。
- 每行 JSON 有 `timestamp` 與遞增的 `ordinal`。

## 範圍

### 範圍內

四種建議：`long-session`、`cache-spike`、`fat-tool-result`、`heavy-baseline`，加上 context 佔用量量表與上一輪用量明細。

### 範圍外

- `repeated-read`：Codex 的讀檔包在 `exec` 的 JS 字串裡，解析不可靠，第一版不做。
- 工具清單（`ToolsPanel`）、subagent 追蹤：同理，依賴 Claude 的工具名稱。
- `rate_limits.primary.used_percent`（Codex 才有）：另案再議。
- 等你提示、任務清單：各自另開 spec。

## 設計

### 資料流

```
Codex hook（SessionStart 等）
  └─ 狀態檔寫入 transcriptPath（= payload.transcript_path，rollout 檔；只有 Codex 寫）
watch（App.tsx 的 transcript watcher）
  └─ codex session 用 state.transcriptPath；claude 維持 resolveTranscriptPath(claudeSessionDir, id)
  └─ tail-runtime 依 agent 選解析器：claude → parseNewContent，codex → parseCodexRollout
parseCodexRollout（新，src/usage/codex-rollout.ts）
  ├─ token_count.last_token_usage → ParsedEvent.usage
  ├─ custom_tool_call_output 文字長度 → toolResultChars（工具名由 call_id 對回 custom_tool_call.name）
  └─ timestamp → 訊息時間、session 起訖
accumulate / detect（重用）
```

### 語意對應

| ParsedUsage 欄位 | Codex 來源 |
|---|---|
| `cacheRead` | `cached_input_tokens` |
| `cacheCreation` | `input_tokens − cached_input_tokens`（這輪沒命中 cache、需重算的 token） |
| `input` | 0 |
| `output` | `output_tokens` |

佔用量 = `input + cacheRead + cacheCreation` = `input_tokens`，`accumulate` 不必改。
`cacheCreation` 是推論：OpenAI 的 prompt cache 沒有「寫入」計費，「沒命中的部分」是最接近的替代。

- **去重**：`messageId = "total:" + total_token_usage.total_tokens`。累計值只增不減，同一值只算一次，
  避免重複的 `token_count` 行讓訊息數與 `cacheCreationRollingAvg` 失真。
- **context 視窗**：解析器把 `model_context_window` 帶進 usage（新欄位 `contextWindow?: number`），
  `accumulate` 存到 stats（`lastContextWindow?`）。`contextOccupancyPct(tokens, window = CONTEXT_WINDOW_TOKENS)`
  加視窗參數；Claude 不傳，維持 1,000,000，行為不變。
- **門檻不動**：長 session 200 則／90 分鐘、cache 暴增 `max(20000, 5 × 平均)` 且前面至少 5 則、
  肥工具結果 8000 token（字元數 ÷ 4）、開場偏重 50000。
- **狀態檔**：`TaskStateSchema` 新增 optional `transcriptPath`；hook 對 codex 寫入 `payload.transcript_path`
  （沒有就沿用既有值）。舊狀態檔沒有此欄位，照現有「這個 session 還沒有 transcript 路徑，尚未納入分析」處理。
- **UI**（`src/ui/App.tsx`，已逐處確認）：
  - advice 檢視（`a`）：Codex 不再回 `CODEX_UNSUPPORTED_NOTICE`，改與 Claude 一樣依 `transcriptPath` 判斷「尚無路徑」。
  - context 量表、佔用量行、上一輪明細（約 L723、L904-908）本來就不依 agent 分流，只讀 `peek(sessionId)` 的統計；
    Codex 有統計後自然會顯示，但呼叫端 `formatContextGaugeBar`／`formatOccupiedTokensLine` 要改為傳入
    `stats.lastContextWindow`，否則會用 1,000,000 算出偏低的佔用率。
  - 上一輪明細標籤依來源切換：Claude 維持 `cache read · cache create · input`，Codex 顯示
    `cached {n} · 新算 {n}`（`cacheRead` → cached，`cacheCreation` → 新算；`input` 恆為 0、`output` 不在明細內）。
  - cache 檢視（`c`，狀態檔 JSON）與 tools 檢視（`t`）維持對 Codex 顯示「尚未支援」：前者不屬於用量分析，
    後者依賴 Claude 工具名稱，兩者皆不在本次範圍。

### 建議文案（依來源）

現有文案有三處對 Codex 是錯的，`detect` 需知道來源（`SessionUsageStats` 加 `agent?`，由 `prime` 帶入）：

| 建議 | Claude（不變） | Codex |
|---|---|---|
| `cache-spike` | 「…別在這個 session 裡繼續換工具/MCP 設定（剛剛因此重算了 X，平常 Y）」 | 「這一輪重算了 X token（平常 Y），可能是閒置太久 cache 過期或 context 被改動；長時間離開後建議另開新 session」 |
| `long-session` | 「…執行 /clear 或另開新 session…」 | 「…另開新 session…」（不指定指令，未確認 Codex 有同名指令） |
| `fat-tool-result` | 「…加上 head/grep/limit 或 Read 的 offset/limit…」 | 「…加上 head/grep 縮小輸出…」 |
| `heavy-baseline` | 不變 | 移除「task-tracker inspect」（Codex 不支援 inspect） |

### 錯誤處理

- 壞行略過、缺欄位當 0、跨 chunk 半行接下一次讀、檔案被截斷則重新 `prime`：全部沿用 `tail-transcript` /
  `tail-runtime` 現有機制。
- 用量分析任何錯誤都不能拖垮主畫面，維持 `App.tsx` 現有 try/catch。
- rollout 檔在 hook 觸發時可能尚未建立：watcher 已用 `add`／`change` 同一個 handler，沿用。

### 測試

- fixture：一份去識別化的真實 Codex 0.155.1 rollout 片段，放 `src/fixtures/`（比照
  `codex-0.155.1-hook-samples.jsonl`），內含多筆 `token_count`（含重複值）、`custom_tool_call` 與其 output。
- 單元：`parseCodexRollout`（token 對應、去重、output 長度、call_id 配對、壞行、半行）、`contextOccupancyPct` 視窗參數、
  `TaskStateSchema` 讀寫 `transcriptPath`、hook 對 codex 寫入 `transcriptPath` 而 claude 不寫。
- 整合：走完 `parse → accumulate → detect`，四種建議在 Codex 資料上會觸發，文案為 Codex 版，Claude 文案不變（既有測試須全過）。
- `pnpm typecheck`、`pnpm test`。

## 風險

- `cacheCreation = input − cached` 為推論；標籤與文案已避免稱之為 cache 寫入。
- Codex 版本更新可能改 rollout 格式：解析器對未知欄位與缺欄位保持寬鬆，並以 0.155.1 fixture 鎖住現況。
- Codex 的 prompt cache 閒置過期會讓 `cache-spike` 在「久未互動後的第一輪」觸發；文案已寫明可能原因，
  是否需要對閒置間隔另設抑制，留待實際使用後再看。

## 實作順序（交給 writing-plans 細化）

1. 狀態檔 `transcriptPath`（schema + hook + 測試）。
2. `parseCodexRollout` + fixture + 單元測試。
3. context 視窗參數化（`context-snapshot.ts`、`types.ts`、`accumulate.ts`）。
4. `tail-runtime` 依 agent 選解析器；`App.tsx` 用 `transcriptPath`、放行 Codex 檢視。
5. `detect` 依來源切換文案；上一輪明細標籤。
6. README 更新（Codex 支援現況、補「session 送出第一個 prompt 才會出現」）。
