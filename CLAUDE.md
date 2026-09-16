# claude-code-task-tracker

## 開分支

開新分支時，前綴用**目前登入的 GitHub account name**，不要寫死 `cursor/` 或其他固定字串。

1. 先查帳號：`gh api user -q .login`（或 `gh auth status` 看 Active account）
2. 分支名：`<login>/<簡短描述>`，例如 `gogogohuang/session-cache-show`

帳號會隨 `gh auth switch` 改變；每次開分支都重新查，不要沿用舊對話裡的前綴。

## PR 發版

每個要開的 PR 都先升版，完成條件是 `package.json` 的 `version` 與 PR 的 base branch 不同，且 README 的「目前版本」寫成同一個號碼。

- 新功能：minor（`0.7.1` → `0.8.0`）
- 修正或文件：patch（`0.7.1` → `0.7.2`）
- `task-tracker version` 讀 `package.json`，不必改 CLI
- 只有這次變更會讓既有 hook 失效時，才改 README「升到 vX.Y.Z 後要再執行一次」那行

## Context 衛生

在這個 repo 跑 Claude Code 時遵守，用來少灌主線 Messages。

### 子 agent

派 `Agent` / 子任務時，交回主線只能有：

- 結論（≤15 行）
- 改了哪些路徑
- 測試指令與結果（通過/失敗各一行）
- 後續要 `Read` 的檔案路徑

禁止：完整 diff、完整 review 原文、整份檔案內容、長 log。細節寫進檔案，主線只給路徑。

### 階段交接

調查 / 實作 / review 結束時，先把進度寫進 `docs/superpowers/plans/` 或
`docs/superpowers/specs/`，再 `/clear` 或開新 session。下一條 session 只 `Read` 那份檔，
不要重讀整個舊對話。

### 可複製範本

**調查結束**

```text
把調查結果寫進 docs/superpowers/specs/<日期>-<主題>-design.md，
只保留：問題、結論、範圍內/外、下一步實作順序。然後 /clear。
```

**實作結束**

```text
把已改檔案、測試指令、剩餘風險寫進同一份 plan 的「完成條件」。
不要把 diff 貼進對話。然後 /clear。下一條 session 只 Read 那份 plan 做 review。
```

**Review 開始（新 session）**

```text
Read <plan 路徑>。只 review 清單裡的檔案。發現寫進 plan 的 Issues，不要把整份檔案 dump 進對話。
```
