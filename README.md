# claude-code-task-tracker

[![npm version](https://img.shields.io/npm/v/claude-code-task-tracker.svg)](https://www.npmjs.com/package/claude-code-task-tracker)

終端機 TUI，即時追蹤 Claude Code 自己開出來的 task（`TodoWrite`，以及新版 `TaskCreate` /
`TaskUpdate` / `TaskList` 系列工具）。就算 session 完全沒開 todo/task 清單，也能看到它
目前在做什麼，例如「正在讀取 src/schema.ts」。

目前版本：**v0.6.0**。套件頁：[npm](https://www.npmjs.com/package/claude-code-task-tracker)。

## 運作原理

1. `task-tracker init` 會在目前專案的 `.claude/settings.json` 註冊 `PreToolUse` 跟
   `PostToolUse` 兩個 hook，matcher 都設為 `*`（涵蓋所有工具，不只 TodoWrite/Task 系列）。
2. 不論 Claude Code 呼叫的是哪個工具，hook 都會把一句可閱讀的活動句寫進
   `~/.claude-task-tracker/<session_id>.json` 的 `activity.summary`。`PreToolUse` 用
   「正在…」，`PostToolUse` 用「已…」。例如讀檔是「正在讀取 src/schema.ts」，Bash 優先用
   工具自帶的短描述，沒有才取指令第一行。句子不包含檔案內容、多行指令或 prompt；抽不出
   可讀片段時，退回「正在使用 Bash」。如果呼叫的剛好是
   `TodoWrite`/`TaskCreate`/`TaskUpdate`/`TaskList`，`PostToolUse` 還會額外跑專屬邏輯
   更新任務清單：`TodoWrite` 是整包覆寫；`TaskCreate` / `TaskUpdate` 是用 `taskId` 累積
   upsert；`TaskList` 若能拿到完整清單則整包 resync，修正前面 create/update 可能累積出的漂移。
   活動列只寫工具動作（例如「正在更新任務清單」），進行中項目的 `activeForm` 仍顯示在任務列。
3. `task-tracker watch` 啟動一個 Ink 打造的 TUI，watch 這個檔案，狀態一有變化就即時重繪。

```
Claude Code (任何工具)
  → PreToolUse / PostToolUse hook → ~/.claude-task-tracker/<session>.json → TUI (watch)
```

## 安裝與使用（npx）

已發布到 npm registry，不需要事先安裝，`npx` 每次都會用最新版本執行：

```bash
cd 你的專案
npx claude-code-task-tracker init     # 只需要做一次，會寫入 .claude/settings.json
claude                                 # 照常開始你的 Claude Code session
```

若你先前已經跑過 `init`，升到 v0.6.0 後要再執行一次，hook 才會改寫活動句。

開發中測試（本機路徑）也可以直接執行 `npx . init` 代替上面的指令。

另開一個終端機視窗：

```bash
npx claude-code-task-tracker watch
```

如果你比較常用，也可以額外裝一次全域指令，之後直接打 `task-tracker` 不用打 `npx`：

```bash
npm install -g claude-code-task-tracker
```

若同時有多個 session 在跑，`watch` 會列出選單讓你選；也可以直接指定：

```bash
task-tracker watch --session <session_id>
```

想確認目前裝的是哪個版本：

```bash
task-tracker version
```

畫面內按 `q` 離開。活動列直接顯示那句話，例如 `◐ 正在讀取 src/schema.ts`；結束後變成
`已讀取 src/schema.ts`。不再前置工具名，也不顯示原始指令。

想看這個目錄啟動 Claude 時會載入哪些 `CLAUDE.md`、rules 與 auto memory：

```bash
npx claude-code-task-tracker inspect
```

## 重要注意事項

- **新版模型預設沒有 TodoWrite**：Sonnet 5、Opus 4.8、Fable 5、Mythos 5 等模型，Claude Code
  預設不會提供 `TodoWrite` / Task 系列工具（避免佔用 context）。如果你用的是這些模型，
  要先設定環境變數才抓得到資料：

  ```bash
  export CLAUDE_CODE_ENABLE_TODO_TOOLS=1
  ```

- **hook payload 結構可能隨版本調整**：`src/schema.ts` 裡的 `HookPayloadSchema` 是依官方
  hooks 文件整理的欄位，用 `.passthrough()` 保留未知欄位以求穩健，但正式串接前建議對照
  當下版本的 [Claude Code hooks 文件](https://docs.claude.com/en/docs/claude-code/hooks)
  再確認一次欄位名稱。
- **`TaskCreate` / `TaskUpdate` / `TaskList` 的欄位是推測值，不是官方 schema**：官方 hooks
  文件目前只證實 `TaskCreate` 對應 `TaskCreated` 這個 hook event，沒有公開
  `tool_input` / `tool_response` 的完整欄位定義；`subject` / `description` / `taskId` /
  `status` / `owner` / `addBlockedBy` / `addBlocks` 這些名稱是依現有非官方資料整理的最佳猜測。
  上游（[anthropics/claude-code#80401](https://github.com/anthropics/claude-code/issues/80401)、
  [#80015](https://github.com/anthropics/claude-code/issues/80015)）也回報過這組工具會
  間歇性從工具清單消失，屬於還在變動中的功能。如果實際 payload 跟猜測的欄位對不上，
  hook 會把錯誤寫進 debug log 並略過那次更新（不會讓狀態檔壞掉），請對照
  `~/.claude-task-tracker/hook-debug.log` 調整 `src/schema.ts` 裡對應的 schema。
- hook 腳本任何時候都不會讓 process 以非 0 結束，避免因為 tracker 的問題打斷你正在跑的
  Claude Code session；所有錯誤會寫進 `~/.claude-task-tracker/hook-debug.log`。

## 專案結構

```
src/
├── cli.tsx                   # commander 進入點（init / watch / inspect / version）
├── describe-activity.ts      # 把工具呼叫收成活動句
├── schema.ts                 # zod schema：TodoWrite 格式、hook payload、狀態檔
├── store.ts                  # 狀態檔案讀寫（write-then-rename 避免讀到半份資料）
├── commands/
│   └── init.ts               # 寫入 .claude/settings.json 的 hook 設定
├── hook/
│   └── task-tracker-hook.ts  # Claude Code 實際呼叫的 hook 腳本
├── inspect/                  # inspect 的解析（CLAUDE.md、rules、auto memory）
└── ui/
    ├── App.tsx               # 主畫面，負責 session 偵測與檔案監控
    ├── SessionPicker.tsx     # 多 session 時的選單
    ├── TaskList.tsx          # task 清單、活動句與進度條
    ├── InspectApp.tsx        # inspect 的互動
    └── InspectView.tsx       # inspect 的排版
```

## 之後可以擴充的方向

- 歷史紀錄（每個 session 結束後保留一份完成率統計）
- 多 session 同時並排顯示（split view）
