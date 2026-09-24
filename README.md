# claude-code-task-tracker

[![npm version](https://img.shields.io/npm/v/claude-code-task-tracker.svg)](https://www.npmjs.com/package/claude-code-task-tracker)

終端機 TUI，即時追蹤 Claude Code 自己開出來的 task（`TodoWrite`，以及新版 `TaskCreate` /
`TaskUpdate` / `TaskList` 系列工具）。就算 session 完全沒開 todo/task 清單，也能看到它
目前在做什麼，例如「正在讀取 src/schema.ts」。也可以接 Codex CLI 的 session（顯示活動句與
用量／cache 建議，見〈Codex 支援〉），並在 `watch` 依來源分頁檢視（見〈分頁檢視〉）。

目前版本：**v0.34.0**。套件頁：[npm](https://www.npmjs.com/package/claude-code-task-tracker)。
## 運作原理

1. `task-tracker init` 會在 `~/.claude/settings.json` 註冊 `SessionStart`、
   `PreToolUse`、`PostToolUse`、`TaskCreated` 與 `TaskCompleted`（所有專案都生效）。
   工具類 matcher 設為 `*`；`TaskCreated` / `TaskCompleted` 不設 matcher。hook 腳本會複製到
   `~/.claude-task-tracker/task-tracker-hook.js`，不會綁死 `npx` 快取路徑。若只要單一專案，
   改跑 `task-tracker init --project`。
2. 不論 Claude Code 呼叫的是哪個工具，hook 都會把一句可閱讀的活動句寫進
   `~/.claude-task-tracker/<session_id>.json` 的 `activity.summary`。`PreToolUse` 用
   「正在…」，`PostToolUse` 用「已…」。例如讀檔是「正在讀取 src/schema.ts」，Bash 優先用
   工具自帶的短描述，沒有才取指令第一行。句子不包含檔案內容、多行指令或 prompt；抽不出
   可讀片段時，退回「正在使用 Bash」。如果呼叫的剛好是
   `TodoWrite`/`TaskCreate`/`TaskUpdate`/`TaskList`，`PostToolUse` 還會額外跑專屬邏輯
   更新任務清單：`TodoWrite` 預設整包覆寫，`merge: true` 則依 id/content 更新；
   `TaskCreate` / `TaskUpdate` 是用 `taskId`（或 `id`）累積 upsert，新建時視為進行中；
   `TaskCreated` / `TaskCompleted` 用官方的 `task_id` / `task_subject` 同步進行中與完成狀態。
   `TaskList` 若能拿到完整清單則整包 resync，修正前面 create/update 可能累積出的漂移。
   活動列只寫工具動作（例如「正在更新任務清單」），進行中項目的 `activeForm` 仍顯示在任務列。
   若 Claude Code 啟動了 dynamic workflow（`Workflow` 工具），hook 會從 script 的 `meta.phases`
   種出 phase 清單；`watch` 再盯 session 目錄裡的 `journal.jsonl`，把每列標成 pending /
   in_progress / completed。巢狀 workflow 的 `▸ …` phase 不另開列，算進最近的父 phase。
3. `task-tracker watch` 啟動一個 Ink 打造的 TUI，watch 狀態檔與 workflow journal，狀態一有變化就即時重繪。
4. Codex 走同一支 hook 腳本：`task-tracker init --agent codex` 把它註冊進 `~/.codex/hooks.json`
   （`SessionStart`、`PreToolUse`、`PostToolUse`、`PermissionRequest`、`Stop`，命令尾端帶 `--agent codex`），寫進同一個狀態目錄，
   狀態檔多一個 `"agent": "codex"`。Codex 有活動句、用量／cache 建議與「等你」核可提示，沒有 task 清單與 workflow，細節見〈Codex 支援〉。

```
Claude Code (SessionStart / 任何工具 / Workflow)
  → hook → ~/.claude-task-tracker/<session>.json
  → journal.jsonl → TUI (watch)

Codex (SessionStart / Bash / apply_patch …)
  → hook --agent codex → ~/.claude-task-tracker/<session>.json（agent: "codex"）
  → TUI (watch，Codex 分頁)
```

## 安裝與使用（npx）

已發布到 npm registry，不需要事先安裝，`npx` 每次都會用最新版本執行：

```bash
cd 你的專案
npx claude-code-task-tracker init     # 只需要做一次，會寫入 ~/.claude/settings.json
claude                                 # 照常開始你的 Claude Code session（若已在跑，請重開一次才會載入 hook）
```

若你先前已經跑過 `init`，升到 v0.7.1 後要再執行一次，hook 才會改寫活動句，並改成使用者層、穩定路徑，也才會接到進行中的 task。

開發中測試（本機路徑）也可以直接執行 `npx . init` 代替上面的指令。

另開一個終端機視窗：

```bash
npx claude-code-task-tracker watch
```

如果你比較常用，也可以額外裝一次全域指令，之後直接打 `task-tracker` 不用打 `npx`：

```bash
npm install -g claude-code-task-tracker
```

若同時有多個 session 在跑，`watch` 會優先自動選目前工作目錄對得上的那一個，標題旁標「目前」。
對不上才依專案列出選單，再選該專案底下的 session。觀看途中按 `b` 可隨時回到專案列表。
若之後又出現新 session，畫面上方會提示並響鈴，但不會自動切走目前正在看的那一個；按 `b` 回列表後提示會消失。也可以直接指定：

`watch` 也會持續分析每個已知 session 的 token 用量（讀 Claude Code 自己寫的 session transcript，
不限目前正在看的那個），偵測到「session 拖太長」「單輪 cache 重算暴增」「單次工具回傳過肥」
「開場底子就重」「同一檔案反覆 Read」這幾種狀況時，會用同一套提示 + 響鈴機制通知你，並直接告訴你現在該做的動作
（例如先把進度寫進 plan 再 `/clear`、開新 session、子 agent 只交結論與路徑、或加 `head`/`limit` 重跑）。cache-spike
若 transcript 帶有 Anthropic API 回報的快取未命中原因（`message.diagnostics.cache_miss_reason`），會多附一行實際原因
（例如「訊息內容跟快取版本不一致」「找不到快取參照的上一則訊息」），不是單純靠門檻猜的；沒有這個欄位時維持原本的文案。
原因是「訊息內容跟快取版本不一致」時，還會再多附一行這個 session 重算前最近一次的工具呼叫（例如
「最近一次工具呼叫：Bash（已執行 npm test）」）當參考情境——這只是時間上最接近的一筆，不是保證的因果關係。
每則建議都依「超過門檻多少」分成
warn（黃）／critical（紅）兩級。`a` 面板依 kind 分組顯示（含 critical 的 kind 排前面），最上面有一行總覽（例如
`共 6 則：fat-tool-result 3 · cache-spike 2 · long-session 1`）；同 kind 且同目標（如同一個檔案）的多筆會合併成一列，
附上次數與累積 token（例如 `（×3 次，累積約 24K token）`）。按 `a` 隨時查看目前所有建議，按 `c` 把這個 session 的
資訊與建議清單複製成純文字（方便貼去其他 AI 工具分析），`b` 回上一頁。
主畫面也會顯示這個 session 實際用過的 tools／MCP 摘要（例如 `tools 5 · mcp 2`）；按 `t` 看完整清單與呼叫次數。

```bash
task-tracker watch --session <session_id>
```

想確認目前裝的是哪個版本：

```bash
task-tracker version
```

一行摘要目前偏好 session（不啟動 TUI；給 tmux／腳本用）。無 session 時印 `none`：

```bash
task-tracker status                 # idle · e9efe088 · ○ 3/5 · 正在讀取 …
task-tracker status --session <id>
task-tracker status --json
task-tracker status --format tmux   # 徽章帶 tmux 色碼（#[fg=...]），給 status-right 用
```

### 終端機整合

`--format tmux` 把 presence 徽章包成 tmux 認得的色碼（等你＝紅、忙碌＝黃、閒置＝綠），可以直接接進 `status-right`：

```tmux
# ~/.tmux.conf
set -g status-right '#(task-tracker status --format tmux) | %H:%M'
set -g status-interval 5
```

Starship 不需要額外的 format，預設的 plain 輸出就是 custom module 吃得下的純文字，顏色交給 starship 自己的 style 設定：

```toml
# ~/.config/starship.toml
[custom.claude]
command = "task-tracker status"
when = true
shell = ["sh", "-c"]
style = "bold green"
format = "[$output]($style) "
```

要列出或檢視 **task-tracker session 暫存**（`~/.claude-task-tracker/<id>.json`），預設只列目前專案。**不會**動 Claude Code 的 transcript，也**不會**反映或改變 context window。

```bash
task-tracker show                           # 列出目前專案的 session 暫存
task-tracker show --all                     # 列出全部專案
task-tracker show --session <id>            # 檢視內容（pretty JSON）
task-tracker show --session <id> --path     # 只印檔案路徑
task-tracker show --session <id> --raw      # 略過解析，印原始檔
```

要清掉暫存（同樣不影響 Claude context）：

```bash
task-tracker clear              # 只清 cwd 對得上的 session 暫存
task-tracker clear --all        # 清全部專案的 session 暫存
task-tracker clear --log        # 一併清 hook-debug.log
```

不會刪 `task-tracker-hook.js`。hook 註冊也不會動。

畫面內按 `q` 離開、按 `b` 回上一層（列表時解除釘選）、在 session 列表畫面按 `Tab`／`Shift+Tab` 切換 Claude／Codex／Cursor 分頁（見〈分頁檢視〉）、按 `v` 與另一 session 雙欄並排（終端寬 ≥ 120；再按 `v`／`b` 退出）、`[` `]` 切左右欄焦點、按 `p` 釘選／解除目前（或焦點）session、按 `c` 複製 session id、`C` 複製暫存 JSON 路徑、按 `n` 跳到其他 session 的「等你」或用量建議、按 `s` 檢視暫存 JSON、按 `d` 清除暫存（需再按一次確認）、按 `a` 查看用量建議（進入後按 `c` 複製這個 session 的資訊＋建議清單純文字）、按 `h` 查看活動紀錄（依呼叫順序回放整個 session，不是只從打開 watch 那刻起算；切走再切回或重開 task-tracker 都不會遺失；每筆寫明這次呼叫做了什麼（例如 `Bash · 已執行 npm test`，與活動列同一套句子），後面附這次呼叫回傳給模型的內容量（單筆、以字元數粗估 token，不是累計），例如 `ctx +1.2K`；超過單次過肥門檻會標黃字，達 2 倍門檻標紅字，跟 `a` 面板用同一套判斷；結果還沒回來就不顯示）、按 `u` 開啟用量總覽〔beta〕（所有 session 依累計用量排序）、按 `f` 開啟焦點（只列出「等你」「有用量建議」的 session，依嚴重度排序，每行顯示最需要處理的那筆建議）、↑↓／j k 捲動。活動列直接顯示那句話，例如 `◐ 正在讀取 src/schema.ts`；結束後變成
`已讀取 src/schema.ts`。不再前置工具名，也不顯示原始指令。活動句語系可由 `TASK_TRACKER_LOCALE=en|zh` 覆寫，否則依 `LANG`（`en*` → en，其餘 zh）。

主畫面會顯示 context 血條（依上一輪佔用 token 相對該 session 回報的視窗（Claude 1M、Codex 258,400）的粗估；≥80% 黃、≥95% 紅）。當 Claude 正在
`AskUserQuestion` 或等待核准計畫時，頂部會出現等待提示並響鈴一次。其他 session 在等你或有新用量建議時，頂列也會彙總並響鈴（按 `n` 跳轉）。若設 `TASK_TRACKER_NOTIFY=1`，同一事件會再發一次 macOS 桌面通知（失敗静默）。若同一工具持續 running 超過約 120 秒且不是在等你，活動列下方會標「可能卡住」。有 workflow 時會多一條 Phase 進度條；活動列下方可顯示「下一個」pending 任務。若約 5 分鐘無更新且沒有進行中的工作，會提示「Session 似乎已結束」；若該 session 有觸發過用量建議，會接在提示下方一併列出（跟 `a` 面板、`c` 複製輸出同一套依 kind 分組格式），讓建議不會因為 session 閒置而消失。專案／session 列表前綴：`!` 等你、
`●` 忙碌、`○` 閒置；整列文字上色（紅＝等你、黃＝進行中、綠＝就緒），進入 session 後標題列同色。
session 列表依最後活動時間（`updatedAt`）由新到舊排序，最新的排最前面；目前／最近使用的
session 仍會標 `(目前)`／`(最近)`。專案列表則依名稱字母排序，只有目前所在專案固定排第一。

派發過 `Agent` 工具（sub-task）時，主畫面會多一塊「Sub-task（Agent 派發）」清單，逐筆顯示派發時的
subagent type／description，◐ 表示還在跑、✔ 表示已回報結果；若派發時明確指定了 model（例如
`sonnet`／`opus`），會一併附在後面（例如 `Explore · 找 schema 定義 · sonnet`），沒指定就不顯示，
不臆測實際套用的預設模型。清單下方再帶一行全域最新的 sidechain 活動句。v1 只做「派發清單＋全域最新
活動句」，平行派發多個 Agent 時無法把 sidechain 活動精準對回是哪一個（transcript 沒有可靠的歸屬欄
位），之後才會升級成逐一 branch 對應。

想看這個專案會進 prompt 的東西：

```bash
npx claude-code-task-tracker inspect
```

除了 `CLAUDE.md`、rules 與 auto memory，也會列出專案與使用者層級的 skills、commands、
agents、output-styles、workflows、agent-memory。如果檔案存在，但因為目前的 `cwd` 不在
它的載入範圍內（例如子目錄的 `.claude/skills` 對上層 session 不可見），會歸進「此目錄不會
載入」那組，跟真的會進這次 session prompt 的項目分開看。

畫面先顯示可捲動的清單（`↑↓` / `j` `k`），同一分組內依檔案大小（byte）由大到小排，並列出體積；按 Enter 進預覽、`b` 回清單、`q` 離開。

用量建議（watch 按 `a`）會列出過肥 tool 回傳、同路徑反覆 Read 等可執行的減肥項；若開場底子偏重，同一則建議下方會嵌該 **session 專案** 的 launch／onDemand 熱力 Top-5（找不到大檔時會提示改跑 `inspect`）。

### 用量總覽（`u`）〔beta〕

> **Beta**：用量占比功能尚未完成（例如 Claude 子 agent 用量還沒計入），數字僅供參考，行為與顯示之後可能調整。

`watch` 按 `u` 會列出所有已知 session（Claude 與 Codex 混合，標示來源），依 presence（等你 `!` <
忙碌 `●` < 閒置 `○`，跟 session 列表同一套分級）優先排序，同一層再依累計用量由大到小，
每列顯示 presence 標記、累計 token、占全部的百分比與一條比例條，整行依 presence 上色：

```text
! [Claude] my-project · 1a2b3c4d  2.3M  41%  █████░░░░░░░
○ [Codex]  other-repo · 9f8e7d6c  1.1M  20%  ██░░░░░░░░░░
```

- **用量的算法**：累計「新增工作量」token = `input + cache creation + output`（Codex：`input − cached + output`），
  **不含 cache 讀取**。Claude 每輪都會重讀整個 context，把 cache 讀取也累加會讓數字被灌爆，失去比較意義。
- 百分比是占「有用量資料的 session 總和」的比例；還沒有用量資料的 session 顯示 `—`，不參與計算。
- 累計值在每次啟動 `watch` 時由 transcript 重算，不另外存檔。
- **限制**：Claude 子 agent（sidechain）用到的 token 不計入累計，重度使用子 agent 的 session 會被低估；
  比較的是工作量，不是花費（不同來源的 token 單價不同）。
- 偶爾沒命中 prompt cache 的那幾輪，`input` 本身就帶著整份 context，會被完整計入；實務上 Claude Code 幾乎都有 cache，影響很小。

### 焦點（`f`）

`watch` 按 `f` 會列出所有「現在該處理」的 session——presence 是等你／忙碌、或帶有 warn／critical
用量建議的才會出現，沒事的 session 不列。依「等你 → critical 建議 → warn 建議 → 忙碌無建議」排序，
每行直接顯示最需要處理的那件事，不用切換 `a`／`u`／`h` 三個面板分別確認：

```text
! my-project · 1a2b3c4d  等你
✗ other-repo · 9f8e7d6c  這一輪重算了 45.0K token，是平常 7.5K 的 6 倍（門檻 5 倍）。 → 現在 /clear 或開新 session…
● third-repo · 3c4d5e6f  進行中
```

## Codex 支援

除了 Claude Code，也可以讓 Codex CLI 的 session 出現在同一個 `watch`。已用 **Codex 0.155.1** 測試。

```bash
npx claude-code-task-tracker init --agent codex             # 寫入 ~/.codex/hooks.json
npx claude-code-task-tracker init --agent codex --project   # 改寫入 <專案>/.codex/hooks.json
```

- 需要在 `~/.codex/config.toml` 開啟 hooks：

  ```toml
  [features]
  hooks = true
  ```

- **hook 必須由你在 Codex 啟動時的 hooks review 核可才會執行。** `init` 只寫 hooks.json，
  不會（也不能）代寫 Codex 的信任紀錄。`codex exec` 沒有核可畫面，未核可的 hook 只會顯示失敗，
  所以請先開一次互動模式的 Codex 核可。
- **Codex 只在啟動時讀取 hooks。** `init` 之前就已經開著的 Codex session 不會出現在 `watch`，
  必須關掉重開；只有 `init` 之後新開的 session 才會被偵測，且 session 要送出第一個 prompt 之後才會出現在 watch。
- **支援活動句與用量／cache 建議**：`watch` 會顯示目前在做什麼（`Bash`、`apply_patch`），並從 Codex 的 rollout 檔
  （狀態檔的 `transcriptPath`）分析 token 用量：`a` 列出長 session、cache 暴增（沒命中 cache 而重算的 token 突然變多）、
  過肥的工具輸出、開場偏重四種建議，畫面也會顯示 context 佔用量表（用 Codex 回報的視窗大小）。
  **不支援**：重複讀檔建議、工具清單（`t`）、任務清單、`inspect`、workflow
  （Codex 0.155.1 沒有 `update_plan` 工具，任務清單來源尚未定案）。在 Codex session 內按 `t`／`s` 會顯示「Codex session 尚未支援此檢視」。
- **等你（`PermissionRequest`）**：Codex 即將跳出核可提示時會觸發這個 hook；收到超過 5 秒仍未核可，
  該 session 才算「等你」——`!` 標記、頂列提示、響鈴、`n` 跳轉都會生效，摘要會寫「等待核可 <工具名稱>」。
  5 秒寬限期是為了濾掉自動核可（`auto_review`）等很快就結束的請求；Codex 官方目前沒有回報「核可已處理」的事件，
  所以核可或拒絕後要等到下一個工具呼叫或 `Stop`（回合結束）才會清除等待狀態。
- 狀態檔仍寫在 `~/.claude-task-tracker/<session_id>.json`，Codex session 會多一個 `"agent": "codex"`；
  舊狀態檔沒有這欄位，一律視為 Claude。

## 分頁檢視

`watch` 的 session 列表畫面上方有 `[Claude] [Codex] [Cursor]` 三個分頁，各自帶該來源的 session 數，
列表與 split 只看目前分頁的 session。

- `Tab`／`Shift+Tab` 切換分頁。**只在 session 列表畫面生效**；已進入某個 session 或在 advice／cache／tools／history／split
  檢視內不會切換，要換分頁請先按 `b` 回列表。切換分頁會回到該來源的專案清單。
- 分頁上紅色的 `!` 代表該來源有 session 正在等你：Claude 是正在跑的 `AskUserQuestion`／`ExitPlanMode`，
  Codex 是收到 `PermissionRequest` 超過 5 秒的核可請求（見〈Codex 支援〉）。
- **Cursor 只是預留分頁**，選到只會顯示尚未支援的說明，還沒有任何 Cursor 整合。

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
├── cli.tsx                   # commander 進入點（init [--agent codex] / watch / inspect / version）
├── agent.ts                  # 來源（claude / codex）與分頁常數 TAB_AGENTS / TAB_LABELS
├── agent-tabs.ts             # 分頁純邏輯：各來源數量、提示色、canSwitchTab
├── codex-config.ts           # 讀 ~/.codex/config.toml 判斷 hooks 是否被關掉
├── install-hooks.ts          # 依 agent（claude / codex）合併 hook 設定
├── describe-activity.ts      # 把工具呼叫收成活動句（含 Codex 的 Bash / apply_patch）
├── usage-overview.ts         # 用量總覽〔beta〕的純函式：presence 優先排序、占比、token 格式化、比例條（按 u）
├── focus-overview.ts         # 焦點的純函式：濾掉沒事的 session、依嚴重度／presence 排序與上色（按 f）
├── session-presence.ts       # presence（等你/忙碌/閒置）分級、前綴符號與顏色，session 列表／split／usage/focus 共用
├── schema.ts                 # zod schema：TodoWrite 格式、hook payload、狀態檔
├── store.ts                  # 狀態檔案讀寫（write-then-rename 避免讀到半份資料）
├── commands/
│   └── init.ts               # 寫入 .claude/settings.json 或 .codex/hooks.json 的 hook 設定
├── hook/
│   └── task-tracker-hook.ts  # Claude Code 與 Codex（--agent codex）實際呼叫的 hook 腳本
├── fixtures/                 # Codex 0.155.1 的 hook payload 與 rollout 樣本（測試重放用）
├── inspect/                  # inspect 的解析（CLAUDE.md、rules、auto memory、prompt 檔案）
├── workflow/                 # dynamic workflow 的 meta.phases 與 journal 解析
├── usage/                    # 跨 session 用量分析（tail transcript／Codex rollout、累計用量、偵測、建議文字、sub-task 派發追蹤）
└── ui/
    ├── App.tsx               # 主畫面，負責 session 偵測、檔案監控與用量建議通知
    ├── SessionPicker.tsx     # 多 session 時的選單
    ├── TaskList.tsx          # task 清單、活動句與進度條
    ├── AdvicePanel.tsx       # 用量建議面板，依嚴重度上色排序
    ├── UsagePanel.tsx        # 可重用的清單面板，用量總覽（按 u）與焦點（按 f）共用
    ├── AgentTabs.tsx         # 來源分頁列
    ├── HistoryPanel.tsx      # 活動 timeline（按 h）
    ├── InspectApp.tsx        # inspect 的互動
    └── InspectView.tsx       # inspect 的排版
```

## 發佈到 npm

一般功能／修 bug 的 PR **不必**改版號。要發新版本時：

1. 合入 `main` 後，在乾淨的 `main` 上本機 bump（會一併改 README「目前版本」）：
   - 新功能：`pnpm version minor`
   - 修 bug／文件：`pnpm version patch`
2. `git push origin main --follow-tags`
3. 在 GitHub **Releases** 建立 Release，**選已存在的 tag**（例如 `v0.18.0`），不要對未 bump 的 tip 新建 tag
4. Actions `publish.yml` 會確認 `package.json`／README 與 tag 一致，通過測試後用 npm Trusted Publishing（OIDC）`pnpm publish`，不需要 `NPM_TOKEN`，也不會改檔或 force-move tag

## 之後可以擴充的方向

- 歷史紀錄（每個 session 結束後保留一份完成率統計）
- Codex 的任務清單（Codex 0.155.1 沒有 `update_plan`，來源可能是它的 `goals` 功能，尚未調查）
- 用量總覽〔beta〕把 Claude 子 agent（sidechain）的用量也算進去（目前不計入）
- Cursor 接入（目前只有預留分頁；要先取樣 Cursor 的 hook payload）
- 用真實 Codex session 驗證用量建議與 context 量表（hook 偵測已在 Codex 0.155.1 驗證過；需先在 Codex hooks review 核可 hook）
