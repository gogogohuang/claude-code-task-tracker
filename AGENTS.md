# claude-code-task-tracker

Shared instructions for coding agents (Claude Code reads this via `CLAUDE.md`, Codex reads it directly). Keep the rules here; don't duplicate them elsewhere.

## Development

- Package manager: `pnpm@9.11.0`, Node `>=18`.
- Run from source: `pnpm dev`
- Type check: `pnpm typecheck`
- Tests: `pnpm test`
- Build: `pnpm build`

Run `pnpm typecheck` and `pnpm test` before committing.

## Branching

When creating a new branch, use the **currently logged-in GitHub account name** as the prefix.

1. First check the account: `gh api user -q .login` (or `gh auth status` for the active account)
2. Branch name: `<login>/<short-description>`, e.g. `gogogohuang/session-cache-show`

The account changes with `gh auth switch`; re-check it every time you create a branch instead of reusing a prefix from an older conversation.

## Releasing

See the `release` skill (`.claude/skills/release/SKILL.md`) for the version-bump and publish checklist.

## Keep the Main Thread Light

Follow this in every agent session in this repo.

### Subagents

When dispatching a subagent / subtask (if your tool supports it), have it return only what the main thread needs to act on: the conclusion, which paths were changed, each test command with its pass/fail result, and the file paths to read next. Details such as diffs, review text, file contents, and logs go into a file, and the main thread gets only its path, because everything returned stays in the main thread's context for the rest of the session.

### Stage Handoff

When investigation / implementation / review finishes, first write the progress into `docs/superpowers/plans/` or
`docs/superpowers/specs/`, then clear the context or start a new session (Claude Code: `/clear`). The next session should only read that file,
not re-read the entire old conversation.

### Reusable Templates

**End of investigation**

```text
Write the investigation results into docs/superpowers/specs/<date>-<topic>-design.md,
keeping only: the problem, the conclusion, in/out of scope, and the next implementation order. Then start a fresh session.
```

**End of implementation**

```text
Write the changed files, test commands, and remaining risks into the same plan's "Completion Criteria".
Don't paste the diff into the conversation. Then start a fresh session. The next session should only read that plan to do the review.
```

**Start of review (new session)**

```text
Read <plan path>. Only review the files in the list. Write findings into the plan's Issues; don't dump the entire file into the conversation.
```

<!-- devlog-tracker:begin -->
## devlog-tracker

這個專案用 devlog-tracker 在 `.devlog/devlog.md` 維護逐輪紀錄（Claude Code 與 Codex 共用同一份）。Codex 指令是 `.agents/skills/devlog-<名稱>/` 底下的 skill，用 `/skills` 選或打 `$devlog-<名稱>` 執行；若 skill 不可用，請照下面對照做：

1. 先 `source .devlog-tracker/env.sh`（設定 `DEVLOG_TRACKER_ROOT`）。
2. 依使用者意圖讀對應的 `.devlog-tracker/commands/<名稱>.md`，照裡面的步驟做（腳本在 `.devlog-tracker/hooks/scripts/`，執行時 `CLAUDE_PROJECT_DIR` 設成專案根目錄）。

| 使用者說 | 讀這份 |
|---|---|
| 開始追蹤 / start | `$devlog-start`；`commands/start.md` |
| 暫停 / pause | `$devlog-pause`；`commands/pause.md` |
| 狀態 / status | `$devlog-status`；`commands/status.md` |
| 接續上一題 / continue（換過工具或 `/clear` 之後） | `commands/continue.md` |
| 歸檔 / compact | `commands/compact.md` |
| 清空重編 / clean（不可復原，先問使用者確認） | `commands/clean.md` |
| 保存主題 / keep、接續具名檔 / resume、跨主題總覽 / overview | `commands/keep.md`、`commands/resume.md`、`commands/overview.md` |
| 長任務定期記錄 / span | `commands/span.md` |
| 調整沉默門檻 / checkpoint、segment-watch | `commands/checkpoint.md`、`commands/segment-watch.md` |
| 開發歷程教訓 / lessons、lessons-on、lessons-off、lessons-drift | `commands/lessons.md`、`commands/lessons-on.md`、`commands/lessons-off.md`、`commands/lessons-drift.md` |

寫 devlog 的格式與規則見 `.devlog-tracker/skills/devlog-tracker/SKILL.md`。每輪結束前必須把當輪寫進 `.devlog/`；已 `start` 的專案，Stop hook 會擋沒寫完的輪次。
<!-- devlog-tracker:end -->
