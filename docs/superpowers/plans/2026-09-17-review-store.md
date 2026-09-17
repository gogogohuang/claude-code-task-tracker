# Code review: store/schema/session-* and related TUI helper modules (2026-09-17)

Scope reviewed (non-test `.ts` sources; paired `.test.ts` files read only to
confirm intended behavior, not reviewed themselves):

- src/store.ts, src/schema.ts, src/session-preference.ts, src/session-presence.ts,
  src/session-pin.ts, src/session-alerts.ts, src/session-ended.ts,
  src/clear-sessions.ts, src/delete-session.ts, src/next-task.ts,
  src/context-snapshot.ts, src/activity-timeline.ts, src/activity-stuck.ts,
  src/describe-activity.ts, src/session-cache-scope.ts, src/format-relative-age.ts,
  src/locale.ts, src/clipboard.ts, src/split-layout.ts, src/split-tasks.ts,
  src/cache-panel-lines.ts, src/desktop-notify.ts

Method: read every source file, then read its paired `.test.ts` (where one
exists) to check the test's asserted behavior actually matches the
implementation, and to find edge cases the tests don't cover. Almost all
reviewed files have very thorough, implementation-matching tests. The
findings below are cases that are either not covered by any test, or
represent a genuine logic inconsistency versus a related, correctly-handled
case elsewhere in the same codebase.

## Findings

### 1. `taskDoneTotal` counts `status: "deleted"` tasks toward the total, but never as done

- File: `src/session-ended.ts:24-31`
- `TaskStatusSchema` (src/schema.ts:37) includes a `"deleted"` status for the
  new Task-series tools. `taskDoneTotal` builds `items = [...tasks, ...todos]`
  and computes `total: items.length` without filtering out
  `status === "deleted"` items, while `done` only counts
  `status === "completed"`.
- Effect: once any task is marked `deleted` (e.g. via `TaskUpdate`), the
  "ended session" summary (`formatEndedSummary`, used for the 任務 X/Y line)
  permanently under-reports completion — a deleted task is counted as an
  outstanding, not-done item forever. If a session ends with several deleted
  tasks, the displayed ratio looks like unfinished work remains when it does
  not.
- Contrast: `pickNextTask` (`src/next-task.ts:4-6`) is careful to only look
  at `status === "pending"` tasks, correctly ignoring `deleted` ones. The
  same exclusion is missing in `taskDoneTotal`. (Note: the exact same bug is
  duplicated in `src/commands/status.ts` — out of this review's scope, but
  confirms this isn't a one-off typo.)
- Suggested fix: filter out `status === "deleted"` items before computing
  both `done` and `total`, e.g.
  `const items = [...tasks, ...todos].filter((t) => t.status !== "deleted")`.
- Severity: Medium (user-visible incorrect summary text; no crash/data loss).

### 2. `pushActivityToTimeline` dedup key ignores `toolName`

- File: `src/activity-timeline.ts:16-19`
```
const last = prev.at(-1);
if (last && last.at === activity.at && last.phase === activity.phase) {
  return prev;
}
```
- The "already recorded, skip" check only compares `at` (timestamp string)
  and `phase`, not `toolName`. If two different tools' activities are
  emitted with the same phase and the same `at` timestamp (possible if two
  hook events land in the same millisecond, e.g. a fast TaskCreate
  immediately followed by another tool call), the second, genuinely
  different activity is silently dropped instead of being appended to the
  timeline.
- The existing test (`activity-timeline.test.ts`, "同 at+phase 不重複") only
  exercises the same-tool case, so this gap isn't caught.
- Suggested fix: also require `last.toolName === activity.toolName` in the
  dedup condition (matching the toolName check already used a few lines
  below for the running→done collapse case).
- Severity: Low/Medium (narrow race window on timestamp collision, but a
  real activity can vanish from the timeline when it happens).

### 3. `STATE_DIR` is computed once at module load time

- File: `src/store.ts:7-12`
```
function resolveStateDir(): string {
  const override = process.env.CLAUDE_TASK_TRACKER_DIR?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".claude-task-tracker");
}
export const STATE_DIR = resolveStateDir();
```
- `STATE_DIR` (and `DEBUG_LOG_PATH`, derived from it) is a module-level
  constant evaluated exactly once, at first import. Any later mutation of
  `process.env.CLAUDE_TASK_TRACKER_DIR` within the same process (e.g. a test
  suite that sets the env var per-test before dynamically importing, or
  code that changes it mid-run) has no effect — every subsequent
  `statePathForSession`/`ensureStateDir`/`appendDebugLog` call keeps using
  whatever directory was resolved at import time.
- This isn't exploitable in normal single-shot CLI usage (env var is set
  before the process starts), but it is a latent footgun for anything in
  the same process that expects `CLAUDE_TASK_TRACKER_DIR` to be
  re-readable, and it's inconsistent with `resolveLocale()`
  (`src/locale.ts`) which re-reads `env` on every call instead of caching.
- Suggested fix (if this matters for the codebase's usage pattern): make
  `resolveStateDir()` exported and called fresh where needed, or keep the
  cached constant but document that it's fixed at process start.
- Severity: Low (design/testability note, not a runtime-observable bug in
  the shipped CLI usage pattern).

### 4. Orphaned `*.json.tmp-<pid>` files are never cleaned up

- Files: `src/store.ts:32-36` (write-then-rename), `src/clear-sessions.ts:32-33`
  and `src/store.ts:52-54` (`listSessionIds`) both filter strictly on
  `name.endsWith(".json")`.
- If a process is killed between `writeFileSync(tmpPath, ...)` and
  `renameSync(tmpPath, finalPath)` (e.g. `kill -9`, OOM, crash), the leftover
  `<sessionId>.json.tmp-<pid>` file doesn't end in `.json`, so it's invisible
  to `listSessionIds()` — good, it won't corrupt the session list — but it's
  also invisible to `clearSessions()`, including with `--all`. These files
  accumulate in `STATE_DIR` indefinitely with no cleanup path.
- Severity: Low (disk clutter only, no correctness impact on the tracked
  session data itself).

## Not bugs (double-checked, working as intended / matches tests)

- `store.ts` write-then-rename is atomic per writer; concurrent renames from
  different PIDs are last-write-wins at the OS level, not corrupting data.
  `readTaskState` wraps both `readFileSync` and `TaskStateSchema.parse` in
  the same `try/catch`, so a mid-write TOCTOU read is handled (returns
  `null`), not a crash.
- `session-preference.ts`, `session-alerts.ts`, `session-ended.ts` (aside
  from finding #1), `activity-stuck.ts`, `describe-activity.ts`,
  `format-relative-age.ts`, `locale.ts`, `clipboard.ts`, `desktop-notify.ts`,
  `split-layout.ts`, `split-tasks.ts`, `cache-panel-lines.ts`,
  `session-presence.ts`, `session-pin.ts`, `schema.ts` all matched their
  test suites' asserted behavior exactly, including boundary conditions
  (ENDED_MS/STUCK_MS/IDLE_MS edges, 32/80-char truncation off-by-one,
  timeline TIMELINE_MAX trimming, path-prefix matching with trailing
  slashes, etc.). No discrepancies found beyond what's listed above.

## Next steps (if fixing)

1. Fix `taskDoneTotal` in `src/session-ended.ts` (and the duplicated
   function in `src/commands/status.ts`, out of this review's scope but
   same fix applies) to exclude `status === "deleted"`.
2. Add `toolName` to the dedup comparison in `pushActivityToTimeline`
   (`src/activity-timeline.ts`).
3. Decide whether `STATE_DIR` caching and orphaned tmp-file cleanup are
   worth addressing; both are low severity and can be deferred.
