# Completion：三層 fallback status + warm/cold transcript 指紋

日期：2026-09-22  
狀態：實作完成 · review 修正已合入（待 commit／PR）

## 做了什麼

1. **`src/status-detect.ts`**：`resolvePresence(state)` 包住既有 `classifyPresence`（一行未改）
   - Tier 1 `hook`：`updatedAt` 新鮮（`< HOOK_FRESH_THRESHOLD_MS = 10s`）→ 原樣 classify
   - Tier 2 `pid`：過期且 `state.pid` 活著 → `idle`
   - Tier 3 `heuristic`：無 pid／pid 死 → `<30s` busy，否則 idle
   - **例外**：`isWaitingForUser` 優先於 Tier 2/3（等待期間 hook 本來就不會重寫）
2. **`TaskState.pid`**：schema optional；SessionStart 寫 `process.ppid`（可測 `parentPid`）；後續 persist 保留
3. **呼叫端**：`status` CLI、`presenceForHint`、`TaskList`、`SplitView`、`App.hintsFor` 改走 `resolvePresence`
4. **`src/usage/cache.ts`**：mtime+size 指紋；`refresh`／`prime` 前 warm skip；讀失敗不更新指紋

## Issues（review）

- [x] Critical：waiting 逾 HOOK_FRESH + pid 活 → 誤 idle → 改 `isWaitingForUser` 短路
- [x] Important：`prime` 讀失敗仍寫指紋 → 僅 `bytesRead>0 || size===0` 才寫
- [ ] Minor：`IDLE_MS` 與 wrap 後語意落差 — 暫不改（文件／舊測試仍用 60s 敘事）

## 測試

- `pnpm typecheck` — pass
- `pnpm test` — pass（426）

## 剩餘風險

- 長工具（>10s、非 waiting）且 hook 停寫：仍會 Tier 2 → idle（設計如此）
- 舊狀態檔無 `pid`：新鮮走 Tier 1，過期走 Tier 3

## 變更檔案

- `src/status-detect.ts` + `.test.ts`（新）
- `src/usage/cache.ts` + `.test.ts`（新）
- `src/usage/tail-runtime.ts` + `.test.ts`
- `src/schema.ts`
- `src/hook/apply-event.ts` + `src/apply-hook-event.test.ts`
- `src/commands/status.ts` + `.test.ts`
- `src/session-preference.ts` + `.test.ts`
- `src/show-session-cache.ts`
- `src/ui/App.tsx`、`TaskList.tsx`、`SplitView.tsx`
- `src/agent-tabs.test.ts`
