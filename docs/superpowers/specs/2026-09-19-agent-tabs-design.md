# watch 依來源分頁檢視設計

日期：2026-09-19　狀態：已核准（對話中），已實作於 gogogohuang/codex-support，待 review
前置：`docs/superpowers/specs/2026-09-19-codex-support-design.md`（提供 `TaskState.agent`，見其「Phase 0 結果」）

## 問題

`task-tracker watch` 的 session 清單不分來源。Codex 支援上線後，Claude 與 Codex session 會混在同一份專案／session
清單裡。使用者要把來源分開看：Claude、Codex、Cursor 各一個 panel。

## 結論

在 `watch` 頂端加 `[Claude] [Codex] [Cursor]` 分頁，一次只顯示一個來源。Cursor 分頁**只保留位置**，內容是
「Cursor 尚未支援」；tracker 目前沒有任何 Cursor 接入，接入另開 spec 並先取樣 Cursor 的 hook payload
（比照 Codex 的 Phase 0）。

已與使用者確認的決定：

1. 形式為**分頁切換**，不做三欄並排、不做清單分群。
2. 切換分頁時**直接回到該分頁的專案清單**（清掉目前選中的 session 與專案），避免畫面與分頁標題對不上。
3. 與 Codex 第一版**同一條分支**（`gogogohuang/codex-support`）依序實作：先 Codex（階段 A），再分頁（階段 B）。

## 範圍

### 範圍內

- 分頁列、`activeAgent` 狀態、依 `agent` 過濾專案／session 清單。
- 切換：`Tab` 往後、`Shift+Tab` 往前循環（Claude → Codex → Cursor → Claude）。不提供 `1`／`2`／`3` 直接跳：`ink-select-input` 會攔截數字鍵 1–9（`node_modules/ink-select-input/build/SelectInput.js`），在 picker 內按數字會變成選項跳選。
- 分頁標題顯示該來源的 session 數，以及是否有 session 正在等待使用者的提示色。卡住偵測不做：`SessionHint` 沒有活動時間戳。
- 既有 split（`v`）限制在同一分頁內：選第二個 session 時只列同來源的 session。
- Codex 分頁對 usage／inspect／cache 顯示「Codex 尚未支援」（codex spec 已定）。

### 範圍外

- Cursor 接入（hook、狀態檔、活動句）。
- 三欄並排、跨來源 split。
- 記住上次選的分頁（重開 `watch` 回到 Claude）。
- Codex 任務清單（待調查 `goals`）。

## 設計

- **來源欄位**：`SessionHint`（`src/session-preference.ts`）加 `agent`，由狀態檔的 `agent ?? "claude"` 填入。
  舊狀態檔沒有 `agent` 一律視為 `claude`，不需遷移。
- **過濾**：新增純函式 `filterSessionsByAgent(sessions, agent)`，放在 `src/session-preference.ts`；
  `groupSessionsByProject`、`projectChoices`、`sessionChoicesInProject` 的輸入先過濾，不改它們內部邏輯，
  所以現有 picker 與 split 流程原樣可用。
- **分頁元件**：新增 `src/ui/AgentTabs.tsx`，只負責畫分頁列（標題、數量、提示色、目前分頁標示）。
  分頁順序與標籤集中在一個常數（`src/agent.ts` 的 `TAB_AGENTS`／`TAB_LABELS`），Cursor 之後接入只需改這裡與狀態來源。
- **App 狀態**（`src/ui/App.tsx`）：新增 `activeAgent`（預設 `claude`）。切換時呼叫既有的「回專案清單」路徑：
  清 `selectedSessionId`、`projectKey`、split 狀態（`pickingSplitPartner`、`splitLeftId`、`splitRightId`）。
- **按鍵**：App 現用 `[ ] a b c C d h n p q s t v Esc`；`Tab`／`Shift+Tab` 未使用。
  只在 session 列表畫面生效：`view === "main"`、尚未選定 session、且不在挑選 split 夥伴時
  （純函式 `canSwitchTab`）。已選定 session 或在 advice／cache／tools／history／split 檢視內不切換，
  避免與該檢視的按鍵混淆；要從 session 內換分頁，先按 `b` 回列表。
- **Cursor 分頁內容**：不讀任何資料，直接顯示一行說明與「接入請見 README」。

## 實作順序

1. 階段 A：Codex 第一版，依 codex spec「實作順序」步驟 2–5（不含已移出的 `update_plan`），並補 `TaskState.agent`。
2. `SessionHint.agent` ＋ `filterSessionsByAgent` ＋ 測試（缺省視為 claude、三種來源、空清單）。
3. `AgentTabs` 元件 ＋ 標題計數／等待提示色的純函式（`src/agent-tabs.ts`）與測試。
4. App 整合：`activeAgent`、切換鍵、切換時回專案清單、split 限同來源。
5. Codex／Cursor 分頁的停用提示。
6. README「分頁檢視」說明，含 Cursor 尚未支援。

版本不在功能 PR 內升；合併後依 `CLAUDE.md` 發版流程 `pnpm version minor`。

## 完成條件

- `watch` 有三個分頁；Claude 分頁只列 Claude session，Codex 分頁只列 Codex session，Cursor 分頁顯示尚未支援。
- 切換分頁後畫面回到該分頁的專案清單，split 與其他檢視不受影響。
- 舊狀態檔（無 `agent`）出現在 Claude 分頁。
- `pnpm typecheck` 與 `pnpm test` 通過，新增測試涵蓋過濾、缺省相容、分頁標題計數、切換鍵位。

## 風險

- `ink-select-input` 會攔截數字鍵 1–9（已驗證，見 `SelectInput.js`），所以不使用 `1`／`2`／`3`，切換只用 `Tab`／`Shift+Tab`。
- 窄終端分頁列換行：分頁標籤用短名並限制單行，寬度不足時只顯示目前分頁與數量。
- 階段 A 未完成前 Codex 分頁必為空：計畫中明確以階段 A 為前置，不單獨發布階段 B。
