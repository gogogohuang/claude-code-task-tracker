# Session 識別、當下建議、進場 context 快照 — Design

## 背景與目標

`watch` 的 session 列表幾乎只顯示完整 UUID，多個 session 不好分辨。用量建議面板把
所有 session 的建議混在一起，進到某一個 session 也看不到窗口有多滿。

三件事一次做：

1. **列表要能辨認**：專案底下的 session 列顯示短 ID、標題、目前活動、相對時間。
2. **建議只看當下**：按 `a` 只列出**正在看的那個 session** 的建議。
3. **第一次進去看 context**：顯示窗口占用 + 活動／任務摘要，同一個 watch 行程裡每個
   session 只顯示一次。

## 非目標

- 不做 Claude Code `/context` 的 System / Skills / Messages 分類拆帳（transcript 沒有）。
- 不在 session 列表上顯示占用 %。
- 不改 hook、不把標題寫進 `~/.claude-task-tracker/<id>.json`。
- 不新增 advice `kind`、不改既有 detector 門檻。
- 不更新 README「升到 vX.Y.Z 後要再執行一次」那行。

## Session 列表識別

專案列表（`projectChoices`）不變。改的是專案底下的 session 列
（`sessionChoicesInProject`，以及仍存在的 `sessionChoices`，保持同一套標籤規則）。

### 標籤格式

```text
e9efe088  (目前) · 修用量面板 · 正在讀取 src/schema.ts · 3 分鐘前
```

用 ` · ` 連接。缺的欄位整段省略，不留下空的分隔符。`(目前)` / `(最近)` 規則不變，
仍緊貼短 ID。

| 欄位 | 來源 |
|------|------|
| 短 ID（超過 8 碼截前 8） | 既有 `shortSessionId` |
| `目前` / `最近` | 既有 `pickPreferredSession` + cwd 對得上與否 |
| 標題 | transcript `type === "ai-title"` 的 `aiTitle`；沒有則用第一句可用的 user prompt |
| 活動句 | 既有 `TaskState.activity.summary` |
| 相對時間 | 既有 `TaskState.updatedAt`，語意與建議面板相同（剛剛 / N 分鐘前 / N 小時前 / N 天前） |

標題與活動句各自最長 **32 字元**，超出截斷並加 `…`。

### 標題怎麼從 transcript 來

不另開檔案掃描。`watch` 已經對每個已知 session `prime` transcript；解析時順便留下
識別欄位，UI 用 `peek(sessionId)` 讀記憶體。

`parseNewContent` 目前遇到沒有 `message` 的行會跳過，因此 `ai-title` 行進不來。要改成：

- `type === "ai-title"` 且 `aiTitle` 是非空字串：記成標題。同一 session 只取**第一次**。
- 主線（`isSidechain !== true`）user 訊息：抽出純文字後，若還沒有 `firstPrompt`，且這句
  **可用**，就記下來。

User 文字來源：`message.content` 是字串就用它；是 array 就串起 `type === "text"` 的
`text`。下列視為不可用，繼續往後找：

- trim 後空字串
- 只有 `tool_result`、沒有 text
- 以 `<local-command-caveat>` 開頭（本機 slash 指令的包裝，不是使用者標題）

列表顯示用 `aiTitle ?? firstPrompt`。還沒掛上 transcript（沒有 `claudeSessionDir`）
或解析不到標題的 session，就只顯示短 ID + 活動 + 時間。

相對時間函式從 `AdvicePanel.tsx` 抽成共用純函式（例如 `src/format-relative-age.ts`），
列表與建議面板共用。

## 用量建議只顯示正在看的 session

背景監控不變：所有已知 session 仍 `prime` / `refresh`，advice 仍累積進記憶體上限
（最近 50 則）。換 session 時建議已經在。

畫面行為改成綁 `selectedSessionId`：

- **已選 session 時按 `a`**：只列出該 `sessionId` 的建議。面板標題
  `用量建議 · {shortId}`。每一則只顯示建議本文 + 相對時間，不再重複專案名／session id。
- **還在專案或 session 列表（沒有 `selectedSessionId`）時按 `a`**：不列建議，顯示
  「先選一個 session 再查看用量建議」。
- **響鈴與上方 notice**：只有這批新建議裡**至少一則**屬於目前 `selectedSessionId`
  才觸發。別的 session 觸發 detector 不吵；之後進去再按 `a` 仍看得到它累積的建議。
- **沒有 transcript 的提示**：只講正在看的這個 session。它沒有 `claudeSessionDir` 才顯示
  「這個 session 還沒有 transcript 路徑，尚未納入分析」；有路徑或還沒選 session 就不顯示
  跨 session 的「N 個 session 還沒有…」。

過濾用純函式 `adviceForSession(advice, sessionId: string | undefined): Advice[]`：
`sessionId` 為 `undefined` 時回空陣列，否則只留該 id。`AdvicePanel` 改吃這份扁平清單
（加上 `shortId` 與空態文案），不再用 `groupAdviceByProject` 做畫面分組。
`groupAdviceByProject` 若沒有其他呼叫端，實作時刪掉；有測試先改測 `adviceForSession`。

## 第一次進入時的 context 快照

同一個 `watch` 行程裡，每個 `sessionId` **第一次**被選進去、且 `taskState` 已讀到時，
在 `TaskList` 上方顯示一塊快照。按 `b` 再進來不顯示。重開 `watch` 會再顯示（只存在
記憶體 `Set`，不落地）。

這次停留期間數字**固定**，不隨 transcript 即時改。離開後活動列仍照舊顯示在任務清單裡。

### 內容

```text
窗口約 686,300 token（約 69%）
◐ 正在讀取 src/schema.ts · 任務 3/10
```

- **窗口占用**：最近一則去重後的主線 assistant `usage`：
  `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`。
  百分比分母固定 **1,000,000**（與 Sonnet 5 `/context` 同量級），文案帶「約」。
  token 數字用 `.toLocaleString("en-US")`。還沒有任何主線 usage 時，第一行改為
  「還沒有用量資料」。
- **活動 + 任務**：第二行是 `活動句 · 任務 done/total`。活動句規則與 `TaskList` 的
  `ActivityLine` 相同（running 前置 `◐`，否則用 summary 或「已使用 …」）。沒有活動且
  任務總數為 0 時，第二行整行省略。第一次停留期間，下方任務清單仍照舊顯示活動列
  （快照與清單可以同時有活動句）。

`parseNewContent` 的 `ParsedUsage` 要加上 `input`（讀 `input_tokens`，缺就當 0）。
`SessionUsageStats` 加上：

- `title?: string`
- `firstPrompt?: string`
- `lastOccupiedTokens?: number`（每次採計一則新的主線 usage 時覆寫）

`tail-runtime` 新增 `peek(sessionId)`，回傳該 session 目前的 `SessionUsageStats | undefined`。
App 組列表 hint 與進場快照都從這裡拿標題與占用，不要再讀一次檔。

進場是否顯示：純函式
`shouldShowContextSnapshot(shownSessionIds: ReadonlySet<string>, sessionId: string): boolean`。
第一次畫出快照後把 `sessionId` 放進 Set。

## 資料流

```
src/usage/tail-transcript.ts   多認 ai-title、可用的 user prompt、input_tokens
src/usage/accumulate.ts        寫入 title / firstPrompt / lastOccupiedTokens
src/usage/tail-runtime.ts      新增 peek(sessionId)
src/usage/advice-groups.ts     以 adviceForSession 取代 groupAdviceByProject
src/usage/types.ts             SessionUsageStats、ParsedUsage 擴充
src/format-relative-age.ts     從 AdvicePanel 抽出
src/session-preference.ts      標籤改短 ID + 標題 + 活動 + 相對時間
src/ui/App.tsx                 過濾建議、notice 條件、進場 Set、把快照資料傳進 TaskList
src/ui/AdvicePanel.tsx         單 session 排版與未選空態
src/ui/TaskList.tsx            第一次進入時渲染快照
```

不改 hook、不改狀態檔 schema。

## 錯誤處理

- 標題、prompt、占用、活動缺一就省略該欄，不擋列表或任務畫面。
- transcript 讀失敗維持 usage-advisor：靜默，不拖垮 TUI；`peek` 不到就當沒有標題／占用。
- `aiTitle` 重複出現（同一 session 多行）只取第一次，不來回閃標籤。

## 測試

行為抽純函式，App.tsx 本身不測（跟現況一樣）。TDD：先寫失敗測試。

- `tail-transcript.test.ts`：`ai-title` 讀 `aiTitle`；第一句可用 user 文字；略過空 text、
  只有 tool_result、`<local-command-caveat>`；`input_tokens` 進 `usage.input`；沒有
  `message` 的 `ai-title` 行不再被丟。
- `accumulate.test.ts`：title / firstPrompt 只記第一次；`lastOccupiedTokens` 隨最新一則
  去重後的主線 usage 更新，`input + cacheRead + cacheCreation`。
- `session-preference.test.ts`：短 ID、`(目前)`、缺欄省略、32 字截斷、相對時間欄位。
- `format-relative-age.test.ts`：剛剛 / 分鐘 / 小時 / 天（把 AdvicePanel 現有語意鎖住）。
- 建議過濾：`adviceForSession` 只留 selected；`undefined` 時為空。
- 快照：占用文案、1M 百分比、`shouldShowContextSnapshot` 同一 id 第二次為 false。
- `tail-runtime`：prime 後 `peek` 拿得到 title 與 `lastOccupiedTokens`。

## PR / 版本

新功能：`package.json` `0.10.0` → `0.11.0`，README「目前版本」同步。不影響既有 hook，
不必更新「升到 vX.Y.Z 後要再執行一次」。