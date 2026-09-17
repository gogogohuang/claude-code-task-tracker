# Code review: src/hook/*, install-hooks.ts, hook install/apply logic (2026-09-17)

Scope reviewed: `src/hook/apply-event.ts`, `src/hook/task-tracker-hook.ts`, `src/install-hooks.ts`,
`src/store.ts` (dependency of both), `src/schema.ts` (HookPayload/TaskState shapes), `src/session-preference.ts`
(`normalizeOptionalCwd`), `src/workflow/paths.ts`, `src/workflow/parse-meta.ts`, plus
`src/apply-hook-event.test.ts` and `src/hook-standalone.test.ts` (read to infer intended behavior),
`src/install-hooks.test.ts` (read to infer intended behavior), and the hook-related slice of `src/cli.tsx`
and `src/commands/init.ts`.

No test files were modified or judged; they were only used to infer intended behavior.

## Findings

### 1. Read-modify-write race across concurrent hook invocations for the same session (lost updates)

**Files:** `src/hook/apply-event.ts:136-161` (`applyHookEvent` / `persist`), `src/store.ts:26-48`
(`writeTaskState` / `readTaskState`)

**Severity: High**

Every hook invocation is a brand-new `node task-tracker-hook.js` subprocess (see
`src/hook/task-tracker-hook.ts`). `applyHookEvent` does a classic read-modify-write on the *entire*
per-session state file: `existing = deps.readTaskState(payload.session_id)` (line 138) is read once at
the top, then `persist()` builds a new full `TaskState` from `existing` plus the delta and writes it back
(`store.ts` `writeTaskState`, which is atomic *per write* via tmp-file + rename, but the read...write pair
as a whole is not).

There is no locking, no optimistic-concurrency check (e.g. compare-and-swap on `updatedAt`), and no merge
across writers anywhere in the codebase (`grep -rn "lock\|mutex\|flock"` under `src` turns up nothing
relevant). Claude Code fires hooks per tool call, and tool calls (including nested `Task`/`Agent`
dispatches — this project explicitly tracks those, see `4c4092c feat: track Agent sub-task dispatches`)
can run concurrently within one session, each with the same `session_id`. If two hook subprocesses for the
same session overlap:

- Process A reads state (tasks = {}), computes `upsertTask(..., "task-A", ...)`, writes `{tasks: {A}}`.
- Process B reads state *before A's write lands* (tasks = {}), computes `upsertTask(..., "task-B", ...)`,
  writes `{tasks: {B}}` — silently discarding A's task.

Same failure mode applies to `todos`, `activity`, and `workflow` fields whenever two hook events for one
session are in flight at once (parallel Bash/Read calls, parallel Task/Agent dispatches, etc.).

**Related, same root cause — status regression on out-of-order `TaskCreated`:**
`src/hook/apply-event.ts:174-191`. The bare `TaskCreated`/`TaskCompleted` hook handler computes
`status` purely from `payload.hook_event_name` (`"completed"` vs `"in_progress"`) and passes it straight
into `upsertTask`, with **no fallback to the previous status**. If a `TaskCreated` event for a given
`task_id` is ever delivered/processed after that task's `TaskCompleted` event (plausible given the above
lack of ordering guarantees — each event is an independent subprocess with unpredictable scheduling), the
task silently reverts from `"completed"` back to `"in_progress"` in the UI.

**Suggested fix:** serialize writes per session (e.g. an advisory lock file, or a single long-lived writer
process per session that hook invocations queue to), or move to an atomic append-only event log that the
TUI folds at read time instead of a read-modify-write snapshot file.

### 2. `install-hooks.ts` writes the user's real `.claude/settings.json` non-atomically

**File:** `src/install-hooks.ts:100-103` (`writeSettingsFile`)

**Severity: Medium-High** (low likelihood, high blast radius)

```ts
export function writeSettingsFile(settingsPath: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}
```

This writes directly to the target path with a plain `writeFileSync`. Contrast with `src/store.ts:26-36`
(`writeTaskState`), which explicitly uses a write-to-tmp + `renameSync` pattern specifically "避免 TUI
讀到寫一半的檔案" (to avoid readers seeing a half-written file). `writeSettingsFile` has no such
protection, but it is writing to `~/.claude/settings.json` or `<project>/.claude/settings.json` — a file
Claude Code itself depends on for *all* hooks, permissions, and other settings, not just task-tracker's
own state. A crash, kill, or concurrent writer (e.g. `task-tracker init` racing another process that also
touches settings.json, or the user's editor autosaving mid-write) during this `writeFileSync` can leave
the user's settings.json truncated/corrupted, breaking Claude Code entirely until manually repaired.

**Suggested fix:** reuse the same tmp-file + rename approach `store.ts` already uses for its own state
files.

### 3. No runtime validation of existing `settings.json` shape — malformed hooks crash install instead of failing gracefully

**Files:** `src/install-hooks.ts:61-68` (`stripTrackerHooks`), `src/install-hooks.ts:91-98`
(`readSettingsFile`)

**Severity: Medium**

`readSettingsFile` only guards against outright `JSON.parse` failure (bad JSON syntax) and returns a
friendly error (`無法解析既有的 ${settingsPath}，請手動檢查後再執行 init。`). It performs **no schema
validation** of the parsed object — `ClaudeSettings` is just a TypeScript type assertion
(`JSON.parse(...) as ClaudeSettings`), unlike `HookPayloadSchema`/`TaskStateSchema` elsewhere in the
project, which do use zod at runtime.

If the *existing* settings.json is syntactically valid JSON but has an unexpected shape for a hook event
— e.g. `"hooks": {"PreToolUse": "some-string"}` or a group missing/mistyping `hooks` — then
`stripTrackerHooks` (`groups ?? []` at line 62, then `.map(...)`, and `group.hooks.filter(...)` at line
65) throws an uncaught `TypeError` (`.map`/`.filter` is not a function on a non-array). This exception is
not caught anywhere in `installTrackerHooks`, so it propagates out of `task-tracker init` / `task-tracker
watch` as an unhandled exception/stack trace instead of the graceful "please check your settings.json
manually" message that `readSettingsFile` already offers for the JSON-syntax-error case.

**Suggested fix:** validate the loaded settings' `hooks[event]` shape (or wrap `mergeTrackerHooks` in a
try/catch) and fall back to the same friendly `ok:false` error path used for parse failures.

### 4. `task-tracker watch` always (re-)installs at **user** scope, can double-register the hook alongside a project-scope install

**File:** `src/cli.tsx:106-129` (the `watch` command's `installTrackerHooks({ scope: "user", ... })` call)

**Severity: Low-Medium**

`watch` unconditionally calls `installTrackerHooks` with `scope: "user"`, regardless of whether the user
already ran `task-tracker init --project` for the current project (which writes to
`<cwd>/.claude/settings.json`). Claude Code merges user- and project-scope settings, so if both files end
up with a tracker hook entry, every qualifying event fires the tracker hook **twice** — once per
registration. Each invocation independently does the full read-modify-write in `applyHookEvent`, which
both wastes work and doubles the window for the lost-update race described in Finding 1 (and produces two
slightly different `updatedAt`/`activity.at` timestamps for what is logically one event).

**Suggested fix:** before installing at user scope, check whether the equivalent project-scope hook is
already present (or vice versa) and skip/warn instead of silently layering both.

### 5. (Minor) `extractCreatedTaskId` `??` chain skips a valid fallback when a field has the wrong type

**File:** `src/hook/apply-event.ts:28-34`

**Severity: Low**

```ts
const candidate = obj.taskId ?? obj.id ?? nestedTask?.id;
return typeof candidate === "string" ? candidate : undefined;
```

`??` only falls through on `null`/`undefined`. If a future/buggy `TaskCreate` tool response ever sends
`taskId` as a non-string, non-nullish value (e.g. a number), `candidate` resolves to that non-string value
and the function returns `undefined` — even though `obj.id` might hold a perfectly good string id right
next to it. Low real-world likelihood (Claude Code's task ids are presumably always strings), but worth a
one-line fix (`typeof obj.taskId === "string" ? obj.taskId : typeof obj.id === "string" ? obj.id : ...`)
for robustness given the file's own comments note this schema is a best-guess with no official docs.

## Not flagged (verified correct)

- `task-tracker-hook.ts` stdin JSON parsing and `HookPayloadSchema.safeParse` failures are both handled
  gracefully (debug-logged, hook still exits 0), matching `hook-standalone.test.ts`.
- `applyHookEvent`'s per-tool `safeParse` failures (TodoWrite/TaskCreate/TaskUpdate/TaskList) all degrade
  gracefully to an activity-only update, preserving existing `todos`/`tasks`, matching
  `apply-hook-event.test.ts`.
- `mergeTrackerHooks`/`stripTrackerHooks` idempotency (installing twice) is correct for the well-formed
  case: re-running produces byte-identical `hooks` JSON, so `already: true` is reported and no
  unnecessary rewrite happens — matches `install-hooks.test.ts`.
- `normalizeOptionalCwd` + the `persist()` cwd fallback chain (`payload.cwd` → `existing.cwd` →
  `process.cwd()`) matches `apply-hook-event.test.ts`'s empty-cwd test.
- `store.ts`'s own state file writes (`writeTaskState`) are properly atomic (tmp + rename); the issue is
  only that `install-hooks.ts` doesn't reuse that same pattern for `settings.json` (Finding 2).
