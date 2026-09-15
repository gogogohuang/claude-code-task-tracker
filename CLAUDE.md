# claude-code-task-tracker

## PR 發版

每個要開的 PR 都先升版，完成條件是 `package.json` 的 `version` 與 PR 的 base branch 不同，且 README 的「目前版本」寫成同一個號碼。

- 新功能：minor（`0.7.1` → `0.8.0`）
- 修正或文件：patch（`0.7.1` → `0.7.2`）
- `task-tracker version` 讀 `package.json`，不必改 CLI
- 只有這次變更會讓既有 hook 失效時，才改 README「升到 vX.Y.Z 後要再執行一次」那行
