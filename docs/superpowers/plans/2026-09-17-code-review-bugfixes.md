# Code Review Bug Fixes — Implementation Plan

> 來源：2026-09-17 全 repo bug review，四份完整筆記在
> `docs/superpowers/plans/2026-09-17-review-{store,hooks,ui,workflow-usage-inspect}.md`。
> 本檔只列修復順序與驗收條件，細節/程式碼片段見上述筆記。

**Goal:** 依嚴重度修掉 review 找到的 14 個 bug，優先處理會造成資料遺失／crash 的 High 項目。

## Tasks

### P0 — High（資料遺失 / crash）

1. ~~**hook read-modify-write race**~~（`src/hook/apply-event.ts:136-161` + `src/store.ts:26-48`）
   ✅ 已修（commit `6516601`）：`store.ts` 新增 `withSessionLock`，`task-tracker-hook.ts` 接上。
2. ~~**TaskCreated/TaskCompleted 亂序回退**~~（`src/hook/apply-event.ts:174-191`）
   ✅ 已修（commit `6516601`，跟 #1 一起）：已 `completed` 的 task 不會被晚到的 `TaskCreated` 打回 `in_progress`。
3. ~~**TUI waitingNotice 讀檔 race 導致 crash**~~（`src/ui/App.tsx:676-685`）
   ✅ 已修：抽出 `session-presence.ts` 的 `waitingNoticeForActivity`（純函式，內建 null 檢查），
   App.tsx 只讀一次 `readTaskState`／`taskState.activity` 存成 `actionActivity` 重複使用，
   移除三次讀檔與 `!` 強制解包。

### P1 — Medium / Medium-High

4. ~~**settings.json 非原子寫入**~~（`src/install-hooks.ts:100-103`）
   ✅ 已修：抽出共用的 `src/fs-atomic.ts`（`writeFileAtomic`，write-then-rename），
   `install-hooks.ts` 的 `writeSettingsFile` 與 `store.ts` 的 `writeTaskState` 都改用它。
5. ~~**taskDoneTotal 誤算 deleted task**~~（`src/session-ended.ts:24-31`）
   ✅ 已修：`taskDoneTotal` 過濾掉 `status === "deleted"` 的 task，不計入分子也不計入分母。
6. ~~**settings.json 缺 schema 驗證**~~（`src/install-hooks.ts:61-68`, `91-98`）
   ✅ 已修：新增 zod 的 `ClaudeSettingsSchema`（只驗證 `stripTrackerHooks` 實際會走訪的已知
   hook 事件形狀，其餘欄位放行），`readSettingsFile` 在 `safeParse` 失敗時走既有的友善錯誤路徑。
7. ~~**activity-timeline dedup 鍵不完整**~~（`src/activity-timeline.ts:16-19`）
   ✅ 已修：dedup 判斷加上 `toolName` 一起比對。

### P2 — Low / Low-Medium

8. ~~**hook 重複安裝**~~（`src/cli.tsx:106-129`）
   ✅ 已修：新增 `hasTrackerHookInstalled`，`watch` 裝 user scope 前先檢查 project scope 是否
   已裝過，裝過就跳過 user scope 安裝。
9. ~~**TaskList 版面 off-by-one**~~（`src/ui/TaskList.tsx:131-133`）
   ✅ 已修：抽出 `src/ui/subagents-block.ts` 的 `subagentBlockRows`（純函式，補上
   `marginBottom={1}` 那一行），`TaskList.tsx` 改用它。
10. ~~**STATE_DIR 環境變數快取**~~（`src/store.ts:7-12`）
    ✅ 已處理：選擇「明確記錄這是刻意的 module-load-once 設計，不改」——每個 hook 事件／CLI／
    TUI 都是獨立 process，process 生命週期內 env var 不會變，不像 `locale.ts` 需要因應同一
    process 內語系切換。在 `STATE_DIR` 定義前加了說明註解，沒有改變行為。
11. ~~**孤兒 tmp 檔案**~~（`src/store.ts:32-36`, `src/clear-sessions.ts:32-33`）
    ✅ 已修：`clearSessions` 遇到 `*.json.tmp-<pid>` 直接清掉（跟 cwd 篩選無關，crash 留下的
    半寫入殘留）。`listSessionIds` 本來就靠 `.endsWith(".json")` 正確排除 tmp 檔，不用改。
12. ~~**extractCreatedTaskId fallback 鏈**~~（`src/hook/apply-event.ts:28-34`）
    ✅ 已修：改成逐一檢查型別再決定要不要 fallback，不再被 `??` 卡在非 nullish 但錯誤型別的值。
13. ~~**AdvicePanel React key 碰撞**~~（`src/ui/AdvicePanel.tsx:79-83`）
    ✅ 已修：key 改成 `` `${line}-${lineIndex}` ``。純 JSX key prop，repo 沒有 Ink 元件的
    render-testing 基礎設施，直接改，沒加測試。
14. ~~**CRLF frontmatter 偵測漏判**~~（`src/inspect/markdown.ts:63`）
    ✅ 已修：`readRulePaths` 一開始先 `replace(/\r\n/g, "\n")` normalize 換行符再比對。

## Completion

- [x] 每個 P0 項目都有對應測試（race 條件可用可重現的併發模擬測試，或至少補上回歸測試涵蓋亂序/重複讀取）
- [x] `pnpm test` 全過（321 個）
- [x] `pnpm typecheck` 全過
- [x] 不 bump version（按 CLAUDE.md，feature/fix PR 不逐次 bump）

全部 14 個 bug 都已修完（P0 3、P1 4、P2 7），逐項分開 commit（見 git log）。
