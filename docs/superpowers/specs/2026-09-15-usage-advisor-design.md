# Usage Advisor — Design

## 背景與目標

`task-tracker watch` 目前只追蹤 Claude Code 自己開出來的 task/todo（透過 hook 寫進
`~/.claude-task-tracker/<session_id>.json` 的活動摘要），完全不看 token 用量。

對其他專案的 session transcript（`~/.claude/projects/<project>/<session_id>.jsonl`）做過一次
人工分析後，找到兩個穩定重現的成本來源：

1. **session 拖太長**：單一 session 訊息數/時間越長，早期塞進 context 的任何內容，就要被後面
   每一輪重複讀（cache_read）越多次。實測中最貴的幾個 session 都有「幾百則訊息、橫跨數小時」
   的特徵。
2. **單輪 cache_creation 暴增**：極少數幾則訊息就佔掉 session 三、四成的新增 token
   消耗。追查發現觸發點是工具清單或 MCP 設定在 session 中途變動（`deferred_tools_delta` /
   `mcp_instructions_delta`），導致 prompt cache 的字首整個失效，逼系統把「system prompt +
   全部工具定義 + 目前為止的完整對話歷史」用全價重算一次，而不是用便宜十倍的 cache_read。
3. （使用者追加）**單次工具回傳過肥**：單一 tool_result 內容異常大（例如沒過濾的 Bash/Read
   輸出），會被當成新內容一次性塞進 context，之後又被拖進「拖太長」的複利效應。

目標：把這個分析常態化成 `watch` 裡的即時監控，偵測到上述三種狀況時，**主動吐出明確、可執行
的建議指令**（不是籠統的「注意用量」），並且跨 session 監控（不限目前正在看的那個），呈現在
一個獨立面板，沿用現有「有新 session 出現」的 banner + 響鈴機制提示。

## 非目標

- 不做門檻值可調整的設定介面（CLI flag / config file）——固定預設值。
- 不修改 hook（`task-tracker-hook.ts`）。usage 資料完全來自 Claude Code 自己寫的 transcript
  檔案，跟 hook 寫的狀態檔是兩份獨立資料。
- 不做歷史統計/報表（跟 README「之後可以擴充的方向」的歷史紀錄是分開的題目）。
- 不處理 `~/.claude/projects/` 底下屬於其他 `cwd`、但跟目前 `watch` 完全無關的 session（範圍
  仍是 task-tracker 目前已知的 `sessionIds`，也就是 hook 寫過狀態檔的那些）。

## 架構

新增 `src/usage/` 模組，全部跑在 `watch` 這個長駐 TUI process 裡：

```
src/usage/
├── types.ts             # UsageEvent, SessionUsageStats, Advice 等型別
├── tail-transcript.ts    # 純函式：parse 新增的 transcript 內容
├── accumulate.ts          # 純函式：把新事件疊進 SessionUsageStats
├── detect.ts              # 純函式：SessionUsageStats + 新事件 → Advice[]
└── tail-runtime.ts        # 唯一非純模組：per-session in-memory tail 狀態
```

### `tail-transcript.ts`

```ts
interface TailState {
  offset: number;               // 上次讀到的 byte offset
  toolUseNameById: Map<string, string>; // tool_use_id -> tool name，供 tool_result 對照
  danglingLine: string;         // 上次讀到一半、還沒換行的殘餘內容
}

interface ParsedEvent {
  isSidechain: boolean;
  usage?: { cacheCreation: number; cacheRead: number; output: number };
  toolResultChars?: { toolName: string | undefined; chars: number };
  timestamp?: string;
}

function parseNewContent(chunk: string, state: TailState): { events: ParsedEvent[]; state: TailState };
```

- 逐行 `JSON.parse`，parse 失敗的行直接跳過（transcript 格式不是 task-tracker 控制的，必須容錯，
  比照現有 hook schema 的 `.passthrough()` 精神）。
- 只從 `message.role === "assistant"` 的行取 `usage`；只從 `message.content[].type ===
  "tool_result"` 取文字長度，並用同一則訊息裡稍早的 `tool_use.id`（存進
  `toolUseNameById`）換回工具名稱。
- `isSidechain` 直接讀該行的 `isSidechain` 欄位；`accumulate.ts` 只累加
  `isSidechain === false` 的事件到主線統計。

### `accumulate.ts`

```ts
interface SessionUsageStats {
  sessionId: string;
  mainThreadMsgCount: number;
  sessionStartedAt: string;      // 該 session 第一筆有 timestamp 的紀錄
  lastMsgAt: string;
  cacheCreationTotal: number;
  cacheCreationRollingAvg: number; // 簡單累積平均，每則主線訊息更新一次
}

function accumulate(prev: SessionUsageStats, events: ParsedEvent[]): {
  next: SessionUsageStats;
  newMainThreadEvents: ParsedEvent[]; // 供 detect.ts 逐一檢查
};
```

### `detect.ts`

```ts
function detect(prev: SessionUsageStats, next: SessionUsageStats, newEvents: ParsedEvent[]): Advice[];

interface Advice {
  sessionId: string;
  kind: "long-session" | "cache-spike" | "fat-tool-result";
  at: string;          // ISO timestamp
  message: string;      // 明確指令，直接顯示在 UI
}
```

三個偵測規則（固定門檻，理由見「背景」章節的實測數據）：

| kind | 條件 | 訊息範本 |
|---|---|---|
| `long-session` | `mainThreadMsgCount` 跨過 200，或 `now - sessionStartedAt` 跨過 90 分鐘（各自只觸發一次，用 next 跨過門檻但 prev 未跨過判斷，避免每則訊息重複提醒） | 「session 已經 {n} 則訊息、開了 {mins} 分鐘，建議現在執行 /clear 或另開新 session，避免之後的訊息持續重算已累積的 context。」 |
| `cache-spike` | 單則主線訊息的 `cacheCreation` > `max(20000, 5 × prev.cacheCreationRollingAvg)`，且 `prev.mainThreadMsgCount >= 5`（session 剛開始、還沒有穩定平均值時不判斷，避免開場就誤報） | 「剛剛這一輪重算了 {n} token 的 context（平常這個 session 大約只要 {avg} token），通常是工具清單或 MCP 設定中途變動造成 cache 失效；這個 session 剩下的部分避免再變更工具/MCP 設定，下次要換工具集，開新 session 比較划算。」 |
| `fat-tool-result` | 單一 tool_result 文字長度 > 30000 字元 | 「{toolName} 剛剛回傳了 {chars} 字元，之後類似操作記得先用 head/grep/limit 縮小輸出，避免整包塞進 context。」（`toolName` 對不到時顯示「某個工具」） |

`long-session` 用「跨過門檻」而非「超過門檻」觸發，其餘兩個本質上是單次事件，天生只會觸發一次，
不需要額外去重。

### `tail-runtime.ts`

```ts
function prime(sessionId: string, transcriptPath: string): { stats: SessionUsageStats; advice: Advice[] };
function refresh(sessionId: string, transcriptPath: string): Advice[]; // 內部更新 in-memory stats
function forget(sessionId: string): void; // session 消失時釋放狀態
```

- `prime`：第一次看到某 session 時，整份讀一次（`readFileSync`），跑過整個 `tail-transcript` +
  `accumulate` + `detect`，讓「watch 中途才打開、session 早就很長」的情況也能立刻抓到問題，
  offset 設為當下檔案大小。
- `refresh`：之後只從 offset 讀新增內容（`fs.readSync` 搭配已知 offset，或用
  `createReadStream(path, { start: offset })`），增量更新。
- 全部狀態存 in-memory（`Map<sessionId, { tailState, stats }>`），watch process 重啟就重新
  `prime`；不落地存檔，因為這是即時監控，不是歷史分析。

## 跨 session 監控 + UI

- `App.tsx` 現有「監控 state 目錄」的 effect 已經知道所有 `sessionIds`。擴充一個新 effect：
  對每個 sessionId 讀它的 `claudeSessionDir`（讀 `~/.claude-task-tracker/<id>.json` 現成欄位），
  組出 transcript 路徑 `${claudeSessionDir}/${sessionId}.jsonl`，對它掛 chokidar watcher
  （`ignoreInitial: true`，因為初始狀態由 `prime` 處理），`change` 時呼叫
  `tail-runtime.refresh`。session 從 `sessionIds` 消失時呼叫 `forget` 並移除對應 watcher。
- 新增全域 `Advice[]` state（依時間新到舊排序，可加簡單上限如最近 50 筆避免無限成長）。
- 新增按鍵 `a`：從主畫面（task list 或 session picker）切到獨立的「建議」面板
  （`AdvicePanel.tsx`），列出目前所有 advice，依專案/session 分組（沿用
  `groupSessionsByProject` 的分組邏輯），顯示 session 標籤 + `message`。按 `b`/`Esc` 回上一個
  畫面。
- 任何 session（不限正在看的那個）冒出新 advice 時，沿用現有 `notice` + `process.stdout.write("\x07")`
  響鈴機制，在目前畫面上方提示「有新的用量建議，按 a 查看」，不強制切走畫面——跟現有「有新
  session 出現」banner 的行為一致。

## 錯誤處理

- transcript 檔案可能中途被壓縮/搬移/不存在（例如 session 被 compact）：`refresh` 讀不到檔案就
  靜默跳過，不影響其他 session 或主 UI；下次檔案變動事件再重試。
- JSON parse 失敗的行（不完整行、格式跑掉）一律跳過，不中斷整批 parse。
- 這整套邏輯全部包在 try/catch 裡，任何錯誤都不能讓 `watch` TUI 本身掛掉或影響現有 task
  list 功能——跟現有 hook「任何時候都不讓 process 以非 0 結束」同一種穩健性要求。

## 測試

- `tail-transcript.test.ts`：多行一次進來、跨 chunk 斷行（最後一行不完整）、壞掉的 JSON 行、
  `isSidechain: true` 的行、tool_use_id 對不到名稱的 tool_result。
- `accumulate.test.ts`：rolling average 計算、多個事件一次疊加。
- `detect.test.ts`：三個 detector 各自的門檻邊界（剛好等於門檻、跨過門檻前後只觸發一次、
  `mainThreadMsgCount < 5` 時 cache-spike 不觸發）。
- `tail-runtime` 用 tmp 檔案做整合測試：模擬檔案分批寫入，確認 `prime` + 連續 `refresh` 的結果
  跟一次讀完全部內容等價。
- UI 部分（`AdvicePanel.tsx` 與 App.tsx 的新 effect）沿用現有 App.tsx 測試模式。

## PR / 版本

依專案 `CLAUDE.md` 規則：這是新功能，`package.json` 版本要 minor bump（目前 0.9.0 →
0.10.0），README「目前版本」同步更新。不影響既有 hook 行為，不需要更新「升到 vX.Y.Z 後要再
執行一次」那行。
