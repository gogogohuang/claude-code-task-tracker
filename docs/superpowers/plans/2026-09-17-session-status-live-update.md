# Session 狀態／即時更新修復（三處）

## Problem

列表、session 內、`task-tracker status` 的 presence／活動不準或不會即時刷新。

## Root causes

1. 空字串 `cwd`（Cursor 等）被當成無效 → 列表像「沒 session」、`status` 回 `none`
2. `sessionHintFromState` 缺 `activityToolName`／`activityPhase` → CLI／hints 路徑 presence 永遠像 idle
3. 選中 session 直接 watch 最終 `.json`；write-then-rename 換 inode 後漏事件

## Changes

- `normalizeOptionalCwd`；persist 時空白 cwd → `process.cwd()`；read/write 正規化
- 無 cwd 進「未知專案」；全無 cwd 時 `pickPreferredSession` 退回全域最新（status）；TUI 仍不自動選
- `sessionHintFromState` 帶 activity 相位／工具名
- App：選中 session 改 watch `STATE_DIR` + basename 過濾（含 unlink）；`stateRevision`；列表也 30s 老化 presence

## Tests

- `pnpm test` → 251 pass

## Follow-up: watch `a` 開場偏重無下方來源

- 熱力誤用 watch 的 `process.cwd()`，應改用 **session.cwd**
- `heatSummaryLines` 只算 launch；67k 來源多在 **onDemand**（skills／workflows）
- 無熱力時仍寫「下方是可能來源」→ 改給 fallback 提示

## Remaining

- 未 commit（等使用者指示）
- v0.19 設計（M2 jump）仍 pending
