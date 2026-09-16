# claude-view vs claude-code-task-tracker

日期：2026-09-16

## 問題

1. 本專案 TUI 還能做什麼（對照 claude-view 的能力缺口／機會）？
2. 本專案哪裡比 [tombelieber/claude-view](https://github.com/tombelieber/claude-view) 好？

## 結論（定位）

兩者**不是同類產品**：

| | claude-code-task-tracker | claude-view |
|---|---|---|
| 形態 | 終端機 Ink TUI | Rust 後端 + React **網頁** Mission Control |
| 資料主軸 | Claude Code **hooks** → 活動句／task／workflow | `~/.claude/projects/**/*.jsonl` 索引 + SSE |
| 目標 | 「現在這一支 session 在做什麼」 | 「機器上所有 session 的監控／聊天／分析／搜尋」 |
| 體積／相依 | npm 套件、Node、無常駐 server | ~10 MB binary、本機 HTTP（預設 port 47892） |

claude-view README 自述為 dashboard（瀏覽器），比較表也沒有「純 TUI competitor」欄位。本專案才是真正的 terminal sidecar。

## Feature 對照（精簡）

| 能力 | task-tracker | claude-view |
|------|:---:|:---:|
| 終端機即時畫面 | ✅ Ink `watch` | ❌（web UI；內嵌 CLI terminal pane 屬 web） |
| 無 todo 也能看「正在…」活動句 | ✅ Pre/PostToolUse hook | 偏 transcript／tool cards，非同一套人話活動句 |
| TodoWrite / TaskCreate·Update·List / TaskCreated·Completed | ✅ 一等公民 | 未當成產品核心 |
| Dynamic workflow `journal.jsonl` phases | ✅ | 有自有 Workflow builder（不同系統） |
| Prompt 表面盤點（`inspect`） | ✅ skills/rules/CLAUDE.md 與「此 cwd 不會載入」 | Skill／hook 追蹤偏 session 內事件 |
| 用量 → **可執行建議**（`/clear`、子 agent 交結論等） | ✅ Usage Advisor | 有 cost／analytics／heatmap，偏報表 |
| 多 session 總覽卡／並排聊天 | 選單切換 | ✅ 強項 |
| 全文搜尋歷史對話 | ❌ | ✅ |
| Sub-agent 樹／完整對話瀏覽 | 活動句有 Agent；無樹／無對話 | ✅ |
| MCP plugin（給 Claude 查 dashboard） | ❌ | ✅ 85 tools |
| 預設 telemetry | 無 | 官方 binary 預設開（可關；source 關） |

## 本專案相對優勢（有證據）

1. **真·TUI**：跟 Claude Code 同一個終端工作流，不開瀏覽器、不佔 port。
2. **Hook 驅動的人話活動列**：`describe-activity` 把 Read/Bash/Agent/… 收成「正在讀取 src/schema.ts」，沒開 todo 也能看。
3. **Task／Todo／官方 Task 事件一等公民**：狀態檔 upsert／resync，不是附帶 UI。
4. **Workflow phase 列**：盯 `journal.jsonl`，跟 Claude 動態 workflow 對齊。
5. **`inspect`**：事前盤點「這次 prompt 會進什麼」，並區分會／不會被此 cwd 載入。
6. **Usage Advisor**：偵測拖太長、cache 重算、tool 過肥、開場底子重，給**動作**而非只顯示 $。
7. **極簡與隱私**：無 server、無預設 telemetry；hook 失敗不拖垮 Claude（非 0 exit）。

## claude-view 更強（不要硬抄）

多 session mission control、成本／heatmap／ROI、全文搜尋、sub-agent 對話樹、加密分享、MCP 插件、Kanban／多視圖——屬「平台」範圍；硬塞進本 TUI 會破壞單一職責。

## TUI 可延伸機會（依現有架構排序）

1. **多 session 並排（split）** — README 已列；picker 已有專案／session 分層。
2. **主畫面 context 量表** — 已有 transcript tail；補視覺 fill，不必做完整 analytics。
3. **近期 tool timeline（N 筆）** — hook 已有 Pre/Post；可 append 短歷史，不必存全文。
4. **等待輸入／計畫核准高亮** — `AskUserQuestion`、`ExitPlanMode` 活動句已有，可升成 banner／響鈴。
5. **Session 結束完成率／簡史** — README 已列；寫入狀態檔摘要即可。
6. **Sub-agent 淺層樹** — `Agent` 活動句已存在；可用 sidechain／session 關聯做一層，不做完整聊天。
7. **Picker 加一行成本／最後活動** — 輕量 transcript 摘要，對齊 claude-view card 資訊密度但不開瀏覽器。

非目標（留給 claude-view）：全文搜尋、週報 heatmap、E2E share、85 MCP tools、系統 CPU dashboard。

## Sources

- 本 repo：`README.md`、`src/describe-activity.ts`、`src/ui/App.tsx`、`docs/superpowers/specs/2026-09-15-usage-advisor-design.md`
- [tombelieber/claude-view README](https://github.com/tombelieber/claude-view/blob/main/README.md)（Live Monitor / Analytics / Privacy / How It Compares）
- `gh api repos/tombelieber/claude-view`：apps = `landing` / `web` / `mobile` / `share`；無獨立 TUI crate
