# claude-code-task-tracker

## Branching

When creating a new branch, use the **currently logged-in GitHub account name** as the prefix. Don't hardcode `cursor/` or any other fixed string.

1. First check the account: `gh api user -q .login` (or `gh auth status` for the active account)
2. Branch name: `<login>/<short-description>`, e.g. `gogogohuang/session-cache-show`

The account changes with `gh auth switch`; re-check it every time you create a branch instead of reusing a prefix from an older conversation.

## Releasing

Do **not** bump the version on every feature/fix PR. To cut a release:

1. Merge feature work to `main`
2. On a clean `main` checkout, bump locally (also syncs README 「目前版本」 via the `version` script):
   - New feature: `pnpm version minor`
   - Fix or docs: `pnpm version patch`
3. Only update the README line "after upgrading to vX.Y.Z, run this again" if this change invalidates an existing hook
4. Push commit + tag: `git push origin main --follow-tags`
5. On GitHub: **Releases → Draft a new release → choose the existing tag** `vX.Y.Z` → Publish  
   Do **not** create a new tag that points at an unbumped commit.
6. `.github/workflows/publish.yml` checks that `package.json` and README match the release tag, runs tests, then publishes to npm via Trusted Publishing (OIDC) — no `NPM_TOKEN`. It does **not** rewrite files or force-move tags.

`task-tracker version` reads from `package.json`; no need to change the CLI for a version bump.

The Trusted Publisher on npmjs.com must list workflow filename `publish.yml` (exact match). Do not force-push `main` or release tags.

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
