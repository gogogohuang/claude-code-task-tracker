# claude-code-task-tracker

## Branching

When creating a new branch, use the **currently logged-in GitHub account name** as the prefix. Don't hardcode `cursor/` or any other fixed string.

1. First check the account: `gh api user -q .login` (or `gh auth status` for the active account)
2. Branch name: `<login>/<short-description>`, e.g. `gogogohuang/session-cache-show`

The account changes with `gh auth switch`; re-check it every time you create a branch instead of reusing a prefix from an older conversation.

## Releasing

Do **not** bump the version on every feature/fix PR. Bump only when cutting a release:

1. Update `package.json` `version` and the README 「目前版本」 line to the same number
   - New feature: minor (`0.7.1` → `0.8.0`)
   - Fix or docs: patch (`0.7.1` → `0.7.2`)
2. Only update the README line "after upgrading to vX.Y.Z, run this again" if this change invalidates an existing hook
3. Merge to `main`, then create a GitHub Release (tag matching the version, e.g. `v0.14.0`)
4. `.github/workflows/publish.yml` publishes to npm via Trusted Publishing (OIDC) — no `NPM_TOKEN`

`task-tracker version` reads from `package.json`; no need to change the CLI for a version bump.

The Trusted Publisher on npmjs.com must list workflow filename `publish.yml` (exact match).

## Keep the Main Thread Light

Follow this when running Claude Code in this repo.

### Subagents

When dispatching an `Agent` / subtask, only the following may be returned to the main thread:

- Conclusion (≤15 lines)
- Which paths were changed
- Test commands and results (one line each for pass/fail)
- File paths to `Read` next

Forbidden: full diffs, full review text, entire file contents, long logs. Put the details in a file; give the main thread only the path.

### Stage Handoff

When investigation / implementation / review finishes, first write the progress into `docs/superpowers/plans/` or
`docs/superpowers/specs/`, then `/clear` or start a new session. The next session should only `Read` that file,
not re-read the entire old conversation.

### Reusable Templates

**End of investigation**

```text
Write the investigation results into docs/superpowers/specs/<date>-<topic>-design.md,
keeping only: the problem, the conclusion, in/out of scope, and the next implementation order. Then /clear.
```

**End of implementation**

```text
Write the changed files, test commands, and remaining risks into the same plan's "Completion Criteria".
Don't paste the diff into the conversation. Then /clear. The next session should only Read that plan to do the review.
```

**Start of review (new session)**

```text
Read <plan path>. Only review the files in the list. Write findings into the plan's Issues; don't dump the entire file into the conversation.
```
