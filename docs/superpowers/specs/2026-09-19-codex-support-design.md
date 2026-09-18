# Codex 支援設計

日期：2026-09-19　狀態：草案（Codex payload 尚未實測，見「未驗證項目」）

## 問題

`task-tracker` 目前只接 Claude Code：`init` 只寫 `~/.claude/settings.json`，活動句與任務清單靠
Claude 的工具名稱（`Read`／`Edit`／`Bash`／`TodoWrite`…），usage／inspect／workflow 追蹤讀 Claude 的
transcript 與 `.claude/` 目錄。使用者希望在 Codex CLI 的 session 也能用同一個 `watch` 看到「現在在做什麼」與任務清單。

## 結論

可行，範圍限縮在 **hook → 狀態檔 → TUI** 這條主幹：

- 本機 Codex 0.146.1 已開 `hooks = true`（`codex features list` 顯示 `hooks stable true`），`~/.codex/hooks.json`
  有 `SessionStart`／`PreToolUse`／`PostToolUse`／`Stop` 等事件，結構與 Claude 相同：
  `{ "hooks": { "<Event>": [ { "hooks": [ { "type": "command", "command": "...", "timeout": N } ] } ] } }`，
  現有條目都沒有 `matcher`。
- 狀態檔 schema、`watch` TUI、活動句、任務列都不需要為 Codex 另寫一套，只需要：安裝端寫進 Codex 的 hooks.json、
  hook 端認得 Codex 的工具名稱與 plan 工具、狀態檔標示來源。
- usage／inspect／workflow 追蹤綁 Claude 專屬資料，**第一版不支援 Codex**，對 Codex session 明確停用而非顯示錯資料。

## 範圍

### 範圍內

1. `task-tracker init --agent codex`：把 tracker hook 合併進 `~/.codex/hooks.json`（`SessionStart`、`PreToolUse`、
   `PostToolUse`）。預設 `--agent claude`，行為不變。
2. Hook 腳本以命令列參數 `--agent codex` 得知來源，不從 payload 猜。
3. `describeActivity` 補 Codex 工具名稱對應；未知工具沿用既有退路「正在使用 X」。
4. `update_plan` → 任務清單（整包覆寫，比照 `TodoWrite` 非 merge）。
5. 狀態檔加 `agent: "claude" | "codex"`（optional，缺省視為 `claude`，舊檔不需遷移）；`watch` 在 session 列顯示來源標記。
6. 測試、README 說明、`task-tracker version` 不動。

### 範圍外（第一版）

- Codex 的 usage／token 估算、`inspect`（AGENTS.md、`~/.codex/config.toml` 的載入分析）、workflow／journal。
- `--project` 範圍的 Codex 安裝（Codex 專案層 hooks 位置未確認）。
- 用 Codex 的 `notify` 設定當備援來源。
- 改套件名稱或 bin 名稱（維持 `claude-code-task-tracker`／`task-tracker`）。

## 設計

### 安裝端（`src/install-hooks.ts`、`src/commands/init.ts`、`src/cli.tsx`）

- 把「寫哪個檔、註冊哪些事件、要不要 matcher」參數化成 agent profile：
  - claude：`~/.claude/settings.json`；`PreToolUse`／`PostToolUse`／`SessionStart`（matcher `*`）＋`TaskCreated`／`TaskCompleted`（不變）。
  - codex：`~/.codex/hooks.json`；`SessionStart`／`PreToolUse`／`PostToolUse`，**不設 matcher**（比照現有條目）。
- 合併沿用 `stripTrackerHooks`：只移除命令含 `task-tracker-hook` 的條目再追加，**保留使用者既有的 TempoTerm、herdr 等 hooks**，
  且要有測試證明（見測試）。重複執行維持冪等（`already`）。
- 命令格式：`"<node>" "<~/.claude-task-tracker/task-tracker-hook.js>" --agent codex`。`isTrackerHookCommand` 仍以
  `task-tracker-hook` 字串判斷，不用改。
- 前置檢查：讀 `~/.codex/config.toml`，若明確 `hooks = false` 就提示使用者開啟；讀不到或無法判斷時只印提醒，不擋安裝。
- `hasTrackerHookInstalled` 依 agent 檢查對應檔案；`readSettingsFile` 的解析失敗訊息帶實際路徑（已是）。

### Hook 端（`src/hook/task-tracker-hook.ts`、`src/hook/apply-event.ts`）

- 解析 `process.argv` 的 `--agent`，缺省 `claude`。傳進 `applyHookEvent` 的 deps／參數，寫入狀態檔 `agent` 欄位。
- `HookPayloadSchema` 已 `.passthrough()`，欄位 `session_id`／`cwd`／`hook_event_name`／`tool_name`／`tool_input`／
  `tool_response` 預期直接可用；若實測發現欄位名不同，在 hook 入口加一層 Codex → 內部格式的 normalize，不改 schema。
- Codex 下略過：`TaskCreate`／`TaskUpdate`／`TaskList` 分支、Workflow 的 `sessionDirFromTranscript`／journal 邏輯。
- `update_plan`：輸入預期為 `{ explanation?: string, plan: [{ step: string, status: "pending"|"in_progress"|"completed" }] }`，
  轉成 `TodoItem { content: step, activeForm: step, status }` 整包覆寫；解析失敗只寫 debug log，不影響活動句。

### 活動句（`src/describe-activity.ts`）

新增 case，皆為候選名稱，Phase 0 依實測調整：

| Codex 工具 | 活動句 |
|---|---|
| `Bash`／`shell`／`exec_command` | 沿用 shell 分支（執行 …）；指令取自 `command`（可能是字串或 argv 陣列，需兩者都處理） |
| `apply_patch` | 「正在修改 <檔案>」，檔名從 patch 標頭（`*** Update File:`／`Add File:`／`Delete File:`）抽第一個；抽不到退回「正在修改檔案」 |
| `update_plan` | 「正在更新計畫」／「已更新計畫」（英文比照 `Updating plan`／`Updated plan`） |
| `mcp__*` 與其他 | 既有 fallback |

原則不變：不存原始指令全文、patch 內容或 prompt。

### 狀態檔與 UI

- `TaskState` 加 `agent: z.enum(["claude","codex"]).optional()`；讀取端一律 `agent ?? "claude"`。
- `watch` session 列與 split 檢視在 codex session 顯示 `[codex]` 標記。usage 面板、cache／inspect 相關視圖對 codex session
  顯示「Codex 尚未支援」一行，不呼叫 Claude 專屬讀取。
- 狀態目錄維持 `~/.claude-task-tracker`（避免搬遷與雙目錄）；Codex session id 為 UUID，與 Claude 不會撞。
- Session 結束偵測（`session-ended`）目前依 Claude 的事件；Codex 沒有對應的 `SessionEnd` 註冊時，靠既有的
  presence／閒置判斷，第一版不新增註冊。

## 未驗證項目（Phase 0 必須先做）

我在本機找不到可用的 Codex 真實 payload（`~/.codex/sessions` 的 rollout 格式與 hook payload 不同），以下都是推測：

1. PreToolUse／PostToolUse 的實際欄位名稱與 `tool_name` 值（`Bash`？`shell`？`apply_patch`？）。
2. `tool_input` 對 shell 是字串還是陣列；`apply_patch` 的 patch 放在哪個欄位。
3. `update_plan` 是否會觸發 hook，以及 input 形狀。
4. Codex 是否對 hook 送 `transcript_path`、`source`（startup／resume）。
5. Codex 專案層 hooks 檔的位置（決定是否做 `--project`）。

Phase 0 做法：暫時在 `~/.codex/hooks.json` 加一個把 stdin 原樣寫到 `~/.claude-task-tracker/codex-sample.jsonl` 的 hook
（合併、不覆蓋現有項目），跑幾個 Codex 指令（讀檔、跑 shell、改檔、觸發 plan），把樣本去敏後存成測試 fixture，
再移除該 hook。Phase 0 的結論回寫到本文件「未驗證項目」。

## 實作順序

1. Phase 0：取樣、確認上列 5 點，更新本文件。
2. `install-hooks.ts` agent profile 參數化 ＋ 合併測試（含保留既有 hooks、冪等）。
3. `init --agent` CLI 與訊息。
4. `TaskState.agent` ＋ hook 入口讀 `--agent`。
5. `describe-activity` Codex 對應 ＋ 測試。
6. `update_plan` → 任務清單 ＋ 測試。
7. `watch` 標記與 usage／inspect 停用提示。
8. README「Codex 支援」章節（含只支援哪些功能）。

實作在新分支進行，分支前綴依 CLAUDE.md 用 `gh api user -q .login` 取得。版本不在功能 PR 內升；合併後依 CLAUDE.md
發布流程做 `pnpm version minor`。

## 完成條件

- `task-tracker init --agent codex` 後，Codex session 的活動句與 `update_plan` 任務清單出現在 `task-tracker watch`。
- 既有 `~/.codex/hooks.json` 其他 hooks 不變；重跑 `init --agent codex` 冪等；`init`（claude）行為與輸出不變。
- `pnpm test` 與 `pnpm typecheck` 通過；新增測試涵蓋：Codex 合併安裝、活動句對應、plan 轉換、舊狀態檔（無 `agent`）相容。
- Codex session 不會觸發 Claude 專屬的 usage／inspect 讀取。

## 風險

- Hook payload 與推測不符：以 Phase 0 樣本收斂，normalize 層集中在 hook 入口，影響面小。
- 覆蓋使用者既有 Codex hooks：只動含 `task-tracker-hook` 的條目，並以測試守住。
- Codex 更新改 hooks 格式：README 註明已測試的 Codex 版本（0.146.1），格式解析失敗時 `init` 報錯不寫檔。
