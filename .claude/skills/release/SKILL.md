---
name: release
description: Version-bump and publish checklist for cutting a claude-code-task-tracker release
---

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
