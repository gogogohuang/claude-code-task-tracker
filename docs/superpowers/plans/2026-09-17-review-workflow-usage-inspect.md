# Code review: src/workflow, src/usage, src/inspect, src/commands (correctness only)

Date: 2026-09-17
Scope: non-test `.ts` files under `src/workflow/`, `src/usage/`, `src/inspect/`, `src/commands/`. Paired `.test.ts` files were read to establish intended behavior but not reviewed themselves.

## Method

Read every non-test source file in the four directories, cross-checked each against its paired test file's assertions (recomputing the logic by hand for boundary cases), and specifically looked for: aggregation/token-count math errors, off-by-one errors, incorrect sort/filter/dedup, race conditions in the tail/polling code (`tail-runtime.ts`), and incorrect assumptions about external JSON/markdown shape.

Files covered:
- `src/workflow/journal.ts`, `parse-meta.ts`, `paths.ts`, `phase-progress.ts`
- `src/usage/accumulate.ts`, `advice-groups.ts`, `advice-heat.ts`, `detect.ts`, `subagents.ts`, `tail-runtime.ts`, `tail-transcript.ts`, `tool-inventory.ts`, `types.ts`
- `src/inspect/discover.ts`, `expand-imports.ts`, `glob.ts`, `heat.ts`, `instructions.ts`, `markdown.ts`, `memory.ts`, `paths.ts`, `preview-display.ts`, `preview.ts`, `prompt-files.ts`, `settings.ts`, `types.ts`, `walk.ts`, `watch-targets.ts`
- `src/commands/clear.ts`, `init.ts`, `show.ts`, `status.ts`

## Findings

### 1. `readRulePaths` only recognizes LF frontmatter delimiters — CRLF rule files silently lose `paths:` scoping

**File:** `src/inspect/markdown.ts:63`

```ts
export function readRulePaths(markdown: string): string[] | null {
  if (!markdown.startsWith("---\n") && markdown !== "---") return null;
  ...
```

If a `.claude/rules/*.md` file has CRLF line endings (common on Windows, or from a repo without `.gitattributes` normalizing to LF), the file starts with `"---\r\n"`, not `"---\n"`. Both branches of the guard are true (`!startsWith("---\n")` is true, and the string isn't exactly `"---"`), so the function returns `null` — i.e. "no frontmatter found" — even though the file has a valid `paths:` list.

**Why it's a bug:** `classifyRule()` in `src/inspect/instructions.ts:97` uses `paths !== null` to decide whether a rule is path-scoped (`onDemand`, only loaded when Claude touches a matching file) vs. always-loaded (`launch`). A CRLF rule file with `paths:` would be misclassified as `launch`, which both misrepresents when it actually loads and inflates the "launch section" byte totals that `heatSummaryLines`/`sortEntriesByHeat` use to explain context bloat to the user.

**Suggested fix:** Normalize line endings before the check, e.g. `const normalized = markdown.replace(/\r\n/g, "\n");` at the top of `readRulePaths`, or use a regex check (`/^---\r?\n/`) instead of a literal `startsWith`.

**Severity:** Low — narrow trigger condition (CRLF-authored rule file), but a genuine, reproducible logic error with a real (if soft) user-facing effect on inspect's classification/heat output.

## Areas checked with no bugs found

- Token/usage aggregation math in `accumulate.ts` (cache totals, rolling average, dedup-by-messageId, `lastOccupiedTokens` composition) — matches all test cases including boundary/replay scenarios.
- Advice thresholds in `detect.ts` (long-session, cache-spike, heavy-baseline, fat-tool-result, repeated-read) — all boundary conditions (`>` vs `>=`) match their paired tests exactly.
- `tail-runtime.ts` / `tail-transcript.ts` offset tracking: offset advances strictly by the fs-layer's actual `bytesRead`, never by a re-derived/decoded byte length, which correctly avoids multi-byte UTF-8 boundary corruption and "fail open" read errors permanently skipping unread bytes (explicitly covered by dedicated tests). No race conditions found — all calls are synchronous, no interleaving is possible within Node's single-threaded model, and the module-level `sessions` Map is only mutated by these synchronous calls.
- `journal.ts`'s phase/step status derivation (`applyJournalToPhases`), including the backward "later phase active â earlier untouched phase considered completed" backfill — behavior matches its test file exactly; only pending (untouched) phases get backfilled, in_progress phases are left alone, which is a deliberate (tested) heuristic, not an oversight.
- `phase-progress.ts`, `parse-meta.ts`, `paths.ts` (workflow) — straightforward, matched tests including nested/legacy journal path resolution.
- `heat.ts` sort/format (`sortEntriesByHeat`, `formatByteSize`, `heatSummaryLines`) — section ordering, descending-by-size sort with missing-size entries pushed last, and B/KB/MB formatting all match tests at their boundaries.
- `glob.ts` (`matchExclude`) — `**/`, `**`, `*`, `?` handling and index bookkeeping traced by hand; correct.
- `settings.ts` layered settings resolution (user → project → local precedence, excludes concatenation/dedup, env var override) — matches tests.
- `expand-imports.ts` — cycle detection via per-branch `chain` set, depth limiting, external/oversized-file handling all correct.
- `instructions.ts`, `prompt-files.ts`, `discover.ts`, `memory.ts`, `walk.ts`, `watch-targets.ts` — classification (launch/onDemand/outOfSession), symlink/external handling, dedup against `already`, and reachability (`isSessionReachable`) logic all traced against their tests including nested-package edge cases; correct.
- `subagents.ts` — dispatch registration/completion matching by `toolUseId`, sidechain-activity tracking — matches tests; known/documented limitation (can't attribute sidechain events to one of several parallel dispatches) is explicitly called out in the module's own doc comment, not an undocumented bug.
- `tool-inventory.ts` — MCP tool name parsing, count aggregation, sorted formatting — matches tests.
- `src/commands/*.ts` (`clear.ts`, `init.ts`, `show.ts`, `status.ts`) — `statusFromState`'s combining of `tasks` and `todos` into one done/total count is intentional per `schema.ts`'s doc comment ("兩者互不影響、可以共存"), not double counting of the same data; session resolution/formatting logic matches tests.

## Next steps

None required to unblock other work; fix in Finding #1 is a small, isolated change to `readRulePaths` if the team wants to address it.
