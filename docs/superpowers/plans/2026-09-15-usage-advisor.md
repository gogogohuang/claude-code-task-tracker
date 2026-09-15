# Usage Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `task-tracker watch` a live, cross-session usage advisor that tails each known session's Claude Code transcript, detects four costly usage patterns, and surfaces one explicit next action per detection in a dedicated panel.

**Architecture:** A new `src/usage/` module does all the work outside the UI: `tail-transcript.ts` parses newly-appended transcript bytes into typed events, `accumulate.ts` folds those events into per-session running stats (deduping by `message.id` so a turn split across multiple JSONL lines is only counted once), `detect.ts` turns state transitions into `Advice` records with single-action messages, and `tail-runtime.ts` wraps all three behind a small in-memory `prime`/`refresh`/`forget` API keyed by session id. `App.tsx` gains a second, incrementally-maintained watcher (one chokidar watcher per known session's transcript file) that feeds `tail-runtime`, plus a new `AdvicePanel` screen reachable with the `a` key, using the existing notice+bell mechanism to announce new advice without switching the user away from what they're looking at.

**Tech Stack:** TypeScript, Node's built-in `node:test` + `node:assert/strict`, Ink (React for terminals), chokidar (already a dependency), zod (unused by this feature, existing dependency only).

**Spec:** `docs/superpowers/specs/2026-09-15-usage-advisor-design.md`

## Global Constraints

- Fixed detector thresholds, no CLI flags or config file (spec "非目標").
- No changes to `src/hook/task-tracker-hook.ts` or the hook payload schema — usage data comes only from Claude Code's own transcript files.
- All usage state lives in memory inside the `watch` process; nothing is persisted to disk, and `watch` restarting means every session gets re-`prime`d from scratch.
- Every turn's `usage` must be deduped by `message.id` before it contributes to totals, rolling average, or `mainThreadMsgCount` — a turn split into multiple content-block lines (e.g. `thinking` + `tool_use`) repeats the same `usage` object on every line (verified 2.19x overcount on real data).
- Every `Advice.message` is a single, concrete, imminently-executable action (a command or a specific next step) with supporting numbers appended — never a general principle.
- This is a new feature: bump `package.json` `version` from `0.9.0` to `0.10.0` and sync README's `目前版本` line (project `CLAUDE.md` rule). No hook behavior changes, so the "升到 vX.Y.Z 後要再執行一次" README line does not need updating.
- Numbers embedded in advice messages use `.toLocaleString("en-US")` (explicit locale) so output and test assertions are deterministic regardless of the host's default locale.

---

### Task 1: Usage types + transcript tailing parser

**Files:**
- Create: `src/usage/types.ts`
- Create: `src/usage/tail-transcript.ts`
- Test: `src/usage/tail-transcript.test.ts`
- Modify: `package.json` (`scripts.test` — add `src/usage/*.test.ts` to the glob)

**Interfaces:**
- Produces: `ParsedUsage`, `ToolResultChars`, `ParsedEvent`, `TailState`, `SessionUsageStats`, `createSessionUsageStats(sessionId: string): SessionUsageStats`, `AccumulateStep`, `AdviceKind`, `Advice` (all from `types.ts`); `createTailState(): TailState`, `parseNewContent(chunk: string, state: TailState): { events: ParsedEvent[]; state: TailState }` (from `tail-transcript.ts`).

- [ ] **Step 1: Create `src/usage/types.ts` with all shared types**

```ts
export interface ParsedUsage {
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

export interface ToolResultChars {
  toolName: string | undefined;
  chars: number;
}

/** 一行 transcript JSONL 解析出來的事件。assistant 行帶 usage；user 行裡的 tool_result 帶 toolResultChars。 */
export interface ParsedEvent {
  messageId: string | undefined;
  isSidechain: boolean;
  timestamp: string | undefined;
  usage: ParsedUsage | undefined;
  toolResultChars: ToolResultChars | undefined;
}

export interface TailState {
  offset: number;
  toolUseNameById: Map<string, string>;
  danglingLine: string;
}

export interface SessionUsageStats {
  sessionId: string;
  mainThreadMsgCount: number;
  sessionStartedAt: string | undefined;
  lastMsgAt: string | undefined;
  cacheCreationTotal: number;
  cacheCreationRollingAvg: number;
  recentMessageIds: string[];
}

export function createSessionUsageStats(sessionId: string): SessionUsageStats {
  return {
    sessionId,
    mainThreadMsgCount: 0,
    sessionStartedAt: undefined,
    lastMsgAt: undefined,
    cacheCreationTotal: 0,
    cacheCreationRollingAvg: 0,
    recentMessageIds: [],
  };
}

/** accumulate() 逐一套用事件時，每個「有效」事件前後的狀態快照，供 detect() 逐事件判斷門檻。 */
export interface AccumulateStep {
  event: ParsedEvent;
  statsBefore: SessionUsageStats;
  statsAfter: SessionUsageStats;
}

export type AdviceKind = "long-session" | "cache-spike" | "fat-tool-result" | "heavy-baseline";

export interface Advice {
  sessionId: string;
  kind: AdviceKind;
  at: string;
  message: string;
}
```

- [ ] **Step 2: Write failing tests for `parseNewContent`**

Create `src/usage/tail-transcript.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTailState, parseNewContent } from "./tail-transcript.js";

function assistantLine(opts: {
  id: string;
  cacheCreation: number;
  cacheRead?: number;
  output?: number;
  isSidechain?: boolean;
  timestamp?: string;
  content?: unknown[];
}): string {
  return JSON.stringify({
    isSidechain: opts.isSidechain ?? false,
    timestamp: opts.timestamp ?? "2026-09-15T00:00:00.000Z",
    message: {
      role: "assistant",
      id: opts.id,
      usage: {
        cache_creation_input_tokens: opts.cacheCreation,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        output_tokens: opts.output ?? 0,
      },
      content: opts.content ?? [{ type: "text", text: "hi" }],
    },
  });
}

function toolResultLine(opts: { toolUseId: string; text: string; isSidechain?: boolean; timestamp?: string }): string {
  return JSON.stringify({
    isSidechain: opts.isSidechain ?? false,
    timestamp: opts.timestamp ?? "2026-09-15T00:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: opts.toolUseId, content: opts.text }],
    },
  });
}

test("parseNewContent 一次讀多行，回傳每個 assistant 訊息的 usage 事件", () => {
  const state = createTailState();
  const chunk = assistantLine({ id: "m1", cacheCreation: 100 }) + "\n" + assistantLine({ id: "m2", cacheCreation: 200 }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events.length, 2);
  assert.equal(events[0].messageId, "m1");
  assert.equal(events[0].usage?.cacheCreation, 100);
  assert.equal(events[1].messageId, "m2");
});

test("parseNewContent 對跨 chunk 斷行的最後一行，先暫存到下一次呼叫再解析", () => {
  const state = createTailState();
  const fullLine = assistantLine({ id: "m1", cacheCreation: 100 });
  const first = parseNewContent(fullLine.slice(0, 10), state);
  assert.equal(first.events.length, 0);
  const second = parseNewContent(fullLine.slice(10) + "\n", first.state);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].messageId, "m1");
});

test("parseNewContent 跳過壞掉的 JSON 行，不影響其他行", () => {
  const state = createTailState();
  const chunk = "not json\n" + assistantLine({ id: "m1", cacheCreation: 100 }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events.length, 1);
  assert.equal(events[0].messageId, "m1");
});

test("parseNewContent 保留 isSidechain 標記，不在這一層過濾", () => {
  const state = createTailState();
  const chunk = assistantLine({ id: "m1", cacheCreation: 100, isSidechain: true }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events[0].isSidechain, true);
});

test("parseNewContent 用稍早看到的 tool_use id 換回工具名稱（tool_use 與 tool_result 在不同行）", () => {
  const state = createTailState();
  const chunk =
    assistantLine({
      id: "m1",
      cacheCreation: 100,
      content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }],
    }) +
    "\n" +
    toolResultLine({ toolUseId: "toolu_1", text: "x".repeat(50) }) +
    "\n";
  const { events } = parseNewContent(chunk, state);
  const toolResultEvent = events.find((e) => e.toolResultChars);
  assert.equal(toolResultEvent?.toolResultChars?.toolName, "Bash");
  assert.equal(toolResultEvent?.toolResultChars?.chars, 50);
});

test("parseNewContent 對不到 tool_use id 時，toolName 是 undefined", () => {
  const state = createTailState();
  const chunk = toolResultLine({ toolUseId: "toolu_missing", text: "x".repeat(10) }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events[0].toolResultChars?.toolName, undefined);
  assert.equal(events[0].toolResultChars?.chars, 10);
});

test("parseNewContent 對缺少 usage 的 assistant 行不產生事件，也不會拋錯", () => {
  const state = createTailState();
  const chunk = JSON.stringify({ isSidechain: false, message: { role: "assistant", id: "m1", content: [] } }) + "\n";
  const { events } = parseNewContent(chunk, state);
  assert.equal(events.length, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --import tsx --test src/usage/tail-transcript.test.ts`
Expected: FAIL — `./tail-transcript.js` does not exist yet.

- [ ] **Step 4: Implement `src/usage/tail-transcript.ts`**

```ts
import { ParsedEvent, TailState } from "./types.js";

export function createTailState(): TailState {
  return { offset: 0, toolUseNameById: new Map(), danglingLine: "" };
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toolResultTextLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") total += text.length;
        continue;
      }
      total += JSON.stringify(block ?? "").length;
    }
    return total;
  }
  return JSON.stringify(content ?? "").length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseNewContent(chunk: string, state: TailState): { events: ParsedEvent[]; state: TailState } {
  const combined = state.danglingLine + chunk;
  const lines = combined.split("\n");
  const danglingLine = lines.pop() ?? "";
  const toolUseNameById = new Map(state.toolUseNameById);
  const events: ParsedEvent[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const isSidechain = parsed.isSidechain === true;
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
    const message = parsed.message;
    if (!isRecord(message)) continue;

    const role = message.role;
    const messageId = typeof message.id === "string" ? message.id : undefined;
    const content = message.content;

    if (role === "assistant") {
      const usage = message.usage;
      if (isRecord(usage)) {
        events.push({
          messageId,
          isSidechain,
          timestamp,
          usage: {
            cacheCreation: numberOr0(usage.cache_creation_input_tokens),
            cacheRead: numberOr0(usage.cache_read_input_tokens),
            output: numberOr0(usage.output_tokens),
          },
          toolResultChars: undefined,
        });
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== "tool_use") continue;
          if (typeof block.id === "string" && typeof block.name === "string") {
            toolUseNameById.set(block.id, block.name);
          }
        }
      }
      continue;
    }

    if (role === "user" && Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block.type !== "tool_result") continue;
        const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
        events.push({
          messageId: undefined,
          isSidechain,
          timestamp,
          usage: undefined,
          toolResultChars: {
            toolName: toolUseId ? toolUseNameById.get(toolUseId) : undefined,
            chars: toolResultTextLength(block.content),
          },
        });
      }
    }
  }

  return {
    events,
    state: {
      offset: state.offset + Buffer.byteLength(chunk, "utf-8"),
      toolUseNameById,
      danglingLine,
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import tsx --test src/usage/tail-transcript.test.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 6: Wire `src/usage/*.test.ts` into the aggregate test script**

In `package.json`, change:

```json
"test": "node --import tsx --test src/*.test.ts src/inspect/*.test.ts src/workflow/*.test.ts src/ui/*.test.ts",
```

to:

```json
"test": "node --import tsx --test src/*.test.ts src/inspect/*.test.ts src/workflow/*.test.ts src/ui/*.test.ts src/usage/*.test.ts",
```

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/usage/types.ts src/usage/tail-transcript.ts src/usage/tail-transcript.test.ts package.json
git commit -m "$(cat <<'EOF'
Add usage types and transcript tailing parser

parseNewContent turns newly-appended transcript JSONL bytes into typed
events (assistant usage, tool_result sizes with tool names resolved
via a persistent tool_use_id map), tolerating chunk-boundary line
splits and malformed lines.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Usage accumulation with message.id dedup

**Files:**
- Create: `src/usage/accumulate.ts`
- Test: `src/usage/accumulate.test.ts`

**Interfaces:**
- Consumes: `ParsedEvent`, `SessionUsageStats`, `createSessionUsageStats`, `AccumulateStep` (from Task 1's `types.js`).
- Produces: `accumulate(prev: SessionUsageStats, events: ParsedEvent[]): { next: SessionUsageStats; steps: AccumulateStep[] }`.

- [ ] **Step 1: Write failing tests**

Create `src/usage/accumulate.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { accumulate } from "./accumulate.js";
import { createSessionUsageStats, ParsedEvent } from "./types.js";

function usageEvent(overrides: Partial<ParsedEvent> & { usage: NonNullable<ParsedEvent["usage"]> }): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp: "2026-09-15T00:00:00.000Z",
    toolResultChars: undefined,
    ...overrides,
  };
}

function toolResultEventFixture(toolName: string | undefined, chars: number): ParsedEvent {
  return {
    messageId: undefined,
    isSidechain: false,
    timestamp: "2026-09-15T00:00:00.000Z",
    usage: undefined,
    toolResultChars: { toolName, chars },
  };
}

test("accumulate 疊加多個事件的 cache_creation 與 rolling average", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [
    usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 0, output: 10 } }),
    usageEvent({ messageId: "m2", usage: { cacheCreation: 300, cacheRead: 0, output: 10 } }),
  ]);
  assert.equal(next.mainThreadMsgCount, 2);
  assert.equal(next.cacheCreationTotal, 400);
  assert.equal(next.cacheCreationRollingAvg, 200);
});

test("accumulate 同一個 messageId 出現多次只採計一次（模擬 thinking + tool_use 共用一輪 usage）", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [
    usageEvent({ messageId: "m1", usage: { cacheCreation: 132914, cacheRead: 0, output: 10 } }),
    usageEvent({ messageId: "m1", usage: { cacheCreation: 132914, cacheRead: 0, output: 10 } }),
  ]);
  assert.equal(next.mainThreadMsgCount, 1);
  assert.equal(next.cacheCreationTotal, 132914);
  assert.equal(steps.filter((s) => s.event.usage).length, 1);
});

test("accumulate 去重跨越兩次呼叫（同一輪的兩行分別在不同 chunk）", () => {
  const stats0 = createSessionUsageStats("s1");
  const first = accumulate(stats0, [usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 0, output: 0 } })]);
  const second = accumulate(first.next, [usageEvent({ messageId: "m1", usage: { cacheCreation: 100, cacheRead: 0, output: 0 } })]);
  assert.equal(second.next.mainThreadMsgCount, 1);
  assert.equal(second.next.cacheCreationTotal, 100);
});

test("accumulate 忽略 isSidechain 的事件", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next } = accumulate(stats0, [
    usageEvent({ messageId: "m1", isSidechain: true, usage: { cacheCreation: 999999, cacheRead: 0, output: 0 } }),
  ]);
  assert.equal(next.mainThreadMsgCount, 0);
  assert.equal(next.cacheCreationTotal, 0);
});

test("accumulate 把 tool_result 事件原封不動放進 steps，不影響 usage 統計或去重", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEventFixture("Bash", 500)]);
  assert.equal(next.mainThreadMsgCount, 0);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].event.toolResultChars?.chars, 500);
  assert.equal(steps[0].statsBefore, steps[0].statsAfter);
});

test("accumulate recentMessageIds 超過上限（30）時丟掉最舊的，較新的 id 仍會被去重", () => {
  let stats = createSessionUsageStats("s1");
  for (let i = 0; i < 35; i++) {
    stats = accumulate(stats, [usageEvent({ messageId: `m${i}`, usage: { cacheCreation: 10, cacheRead: 0, output: 0 } })]).next;
  }
  assert.equal(stats.mainThreadMsgCount, 35);

  // m0 已經被擠出緩衝，重放會被誤判成新事件（緩衝有界是刻意的取捨，見 spec）
  const replayOld = accumulate(stats, [usageEvent({ messageId: "m0", usage: { cacheCreation: 10, cacheRead: 0, output: 0 } })]);
  assert.equal(replayOld.next.mainThreadMsgCount, 36);

  // m34 還在緩衝內，重放會被正確去重
  const replayRecent = accumulate(stats, [usageEvent({ messageId: "m34", usage: { cacheCreation: 10, cacheRead: 0, output: 0 } })]);
  assert.equal(replayRecent.next.mainThreadMsgCount, 35);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/usage/accumulate.test.ts`
Expected: FAIL — `./accumulate.js` does not exist yet.

- [ ] **Step 3: Implement `src/usage/accumulate.ts`**

```ts
import { AccumulateStep, ParsedEvent, SessionUsageStats } from "./types.js";

const RECENT_MESSAGE_ID_LIMIT = 30;

export function accumulate(
  prev: SessionUsageStats,
  events: ParsedEvent[],
): { next: SessionUsageStats; steps: AccumulateStep[] } {
  let stats = prev;
  const steps: AccumulateStep[] = [];

  for (const event of events) {
    if (event.isSidechain) continue;

    if (event.toolResultChars) {
      steps.push({ event, statsBefore: stats, statsAfter: stats });
      continue;
    }

    if (!event.usage) continue;
    if (event.messageId && stats.recentMessageIds.includes(event.messageId)) continue;

    const statsBefore = stats;
    const recentMessageIds = event.messageId
      ? [...stats.recentMessageIds, event.messageId].slice(-RECENT_MESSAGE_ID_LIMIT)
      : stats.recentMessageIds;
    const mainThreadMsgCount = stats.mainThreadMsgCount + 1;
    const cacheCreationTotal = stats.cacheCreationTotal + event.usage.cacheCreation;

    stats = {
      ...stats,
      mainThreadMsgCount,
      sessionStartedAt: stats.sessionStartedAt ?? event.timestamp,
      lastMsgAt: event.timestamp ?? stats.lastMsgAt,
      cacheCreationTotal,
      cacheCreationRollingAvg: cacheCreationTotal / mainThreadMsgCount,
      recentMessageIds,
    };

    steps.push({ event, statsBefore, statsAfter: stats });
  }

  return { next: stats, steps };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/usage/accumulate.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/usage/accumulate.ts src/usage/accumulate.test.ts
git commit -m "$(cat <<'EOF'
Add usage accumulation with message.id dedup

accumulate() folds parsed events into per-session running stats,
skipping any usage event whose message.id was already counted (a
turn split across multiple content-block lines would otherwise be
counted once per line). Emits a before/after stats snapshot per
accepted event so detectors can evaluate thresholds precisely, even
when many events arrive in one batch (e.g. during prime()).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Detection rules for the four advisories

**Files:**
- Create: `src/usage/detect.ts`
- Test: `src/usage/detect.test.ts`

**Interfaces:**
- Consumes: `SessionUsageStats`, `AccumulateStep`, `Advice`, `AdviceKind` (Task 1); `accumulate` (Task 2, test-only).
- Produces: `detect(prev: SessionUsageStats, next: SessionUsageStats, steps: AccumulateStep[]): Advice[]`.

- [ ] **Step 1: Write failing tests**

Create `src/usage/detect.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { accumulate } from "./accumulate.js";
import { detect } from "./detect.js";
import { createSessionUsageStats, ParsedEvent } from "./types.js";

function usageEvent(messageId: string, cacheCreation: number, timestamp: string): ParsedEvent {
  return { messageId, isSidechain: false, timestamp, usage: { cacheCreation, cacheRead: 0, output: 0 }, toolResultChars: undefined };
}

function toolResultEvent(toolName: string | undefined, chars: number, timestamp: string): ParsedEvent {
  return { messageId: undefined, isSidechain: false, timestamp, usage: undefined, toolResultChars: { toolName, chars } };
}

test("detect：long-session 訊息數剛好跨過 200 才觸發一次", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = Array.from({ length: 201 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  const advice = detect(stats0, next, steps);
  const longSession = advice.filter((a) => a.kind === "long-session");
  assert.equal(longSession.length, 1);
  assert.match(longSession[0].message, /\/clear/);
});

test("detect：long-session 剛好等於 200 則不觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = Array.from({ length: 200 }, (_, i) => usageEvent(`m${i}`, 10, "2026-09-15T00:00:00.000Z"));
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "long-session").length, 0);
});

test("detect：long-session 時間跨過 90 分鐘也會觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 10, "2026-09-15T00:00:00.000Z"), usageEvent("m1", 10, "2026-09-15T01:31:00.000Z")];
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "long-session").length, 1);
});

test("detect：cache-spike 在 mainThreadMsgCount < 5 時不觸發，即使數字很大", () => {
  const stats0 = createSessionUsageStats("s1");
  const events = [usageEvent("m0", 100, "t0"), usageEvent("m1", 999999, "t1")];
  const { next, steps } = accumulate(stats0, events);
  assert.equal(detect(stats0, next, steps).filter((a) => a.kind === "cache-spike").length, 0);
});

test("detect：cache-spike 在累積 5 則後，單輪超過 max(20000, 5x平均) 時觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const warmup = accumulate(stats0, Array.from({ length: 5 }, (_, i) => usageEvent(`m${i}`, 1000, `t${i}`)));
  // rolling avg 是 1000，5x=5000，門檻取 max(20000,5000)=20000，30000 超過
  const { next, steps } = accumulate(warmup.next, [usageEvent("spike", 30000, "tspike")]);
  const spikeAdvice = detect(warmup.next, next, steps).filter((a) => a.kind === "cache-spike");
  assert.equal(spikeAdvice.length, 1);
  assert.match(spikeAdvice[0].message, /30,000/);
  assert.match(spikeAdvice[0].message, /\/clear/);
});

test("detect：heavy-baseline 只在第一則訊息判斷，之後即使 cacheCreation 很大也不誤判", () => {
  const stats0 = createSessionUsageStats("s1");
  const first = accumulate(stats0, [usageEvent("m0", 60000, "t0")]);
  assert.equal(detect(stats0, first.next, first.steps).filter((a) => a.kind === "heavy-baseline").length, 1);

  const second = accumulate(first.next, [usageEvent("m1", 60000, "t1")]);
  assert.equal(detect(first.next, second.next, second.steps).filter((a) => a.kind === "heavy-baseline").length, 0);
});

test("detect：heavy-baseline 剛好等於 50000 不觸發，超過才觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const exact = accumulate(stats0, [usageEvent("m0", 50000, "t0")]);
  assert.equal(detect(stats0, exact.next, exact.steps).filter((a) => a.kind === "heavy-baseline").length, 0);
});

test("detect：fat-tool-result 剛好等於 30000 字元不觸發，超過才觸發", () => {
  const stats0 = createSessionUsageStats("s1");
  const exact = accumulate(stats0, [toolResultEvent("Bash", 30000, "t0")]);
  assert.equal(detect(stats0, exact.next, exact.steps).length, 0);

  const over = accumulate(stats0, [toolResultEvent("Bash", 30001, "t0")]);
  const overAdvice = detect(stats0, over.next, over.steps);
  assert.equal(overAdvice.length, 1);
  assert.equal(overAdvice[0].kind, "fat-tool-result");
  assert.match(overAdvice[0].message, /Bash/);
});

test("detect：fat-tool-result 對不到工具名稱時顯示「工具」", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent(undefined, 40000, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.match(advice[0].message, /^重跑剛剛那個 工具 呼叫/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/usage/detect.test.ts`
Expected: FAIL — `./detect.js` does not exist yet.

- [ ] **Step 3: Implement `src/usage/detect.ts`**

```ts
import { AccumulateStep, Advice, SessionUsageStats } from "./types.js";

const LONG_SESSION_MSG_THRESHOLD = 200;
const LONG_SESSION_MINUTES_THRESHOLD = 90;
const CACHE_SPIKE_FLOOR = 20000;
const CACHE_SPIKE_MULTIPLIER = 5;
const CACHE_SPIKE_MIN_PRIOR_MSGS = 5;
const FAT_TOOL_RESULT_CHARS = 30000;
const HEAVY_BASELINE_TOKENS = 50000;

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

function elapsedMinutes(stats: SessionUsageStats): number {
  if (!stats.sessionStartedAt || !stats.lastMsgAt) return 0;
  return minutesBetween(stats.sessionStartedAt, stats.lastMsgAt);
}

function isLongSession(stats: SessionUsageStats): boolean {
  return stats.mainThreadMsgCount > LONG_SESSION_MSG_THRESHOLD || elapsedMinutes(stats) > LONG_SESSION_MINUTES_THRESHOLD;
}

function checkLongSession(before: SessionUsageStats, after: SessionUsageStats): Advice[] {
  if (isLongSession(before) || !isLongSession(after)) return [];
  return [
    {
      sessionId: after.sessionId,
      kind: "long-session",
      at: after.lastMsgAt ?? new Date().toISOString(),
      message: `現在執行 /clear 或另開新 session（這個 session 已經 ${after.mainThreadMsgCount} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`,
    },
  ];
}

function checkCacheSpike(before: SessionUsageStats, step: AccumulateStep): Advice[] {
  const usage = step.event.usage;
  if (!usage) return [];
  if (before.mainThreadMsgCount < CACHE_SPIKE_MIN_PRIOR_MSGS) return [];
  const threshold = Math.max(CACHE_SPIKE_FLOOR, CACHE_SPIKE_MULTIPLIER * before.cacheCreationRollingAvg);
  if (usage.cacheCreation <= threshold) return [];
  return [
    {
      sessionId: before.sessionId,
      kind: "cache-spike",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `現在 /clear 或開新 session，別在這個 session 裡繼續換工具/MCP 設定（剛剛這一輪因此重算了 ${usage.cacheCreation.toLocaleString("en-US")} token，平常只要 ${Math.round(before.cacheCreationRollingAvg).toLocaleString("en-US")}）。`,
    },
  ];
}

function checkHeavyBaseline(before: SessionUsageStats, step: AccumulateStep): Advice[] {
  const usage = step.event.usage;
  if (!usage) return [];
  if (before.mainThreadMsgCount !== 0) return [];
  if (usage.cacheCreation <= HEAVY_BASELINE_TOKENS) return [];
  return [
    {
      sessionId: before.sessionId,
      kind: "heavy-baseline",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `執行 task-tracker inspect 檢查這個專案載入 prompt 的東西（這個 session 開場第一輪就吃了 ${usage.cacheCreation.toLocaleString("en-US")} token）。`,
    },
  ];
}

function checkFatToolResult(stats: SessionUsageStats, step: AccumulateStep): Advice[] {
  const toolResultChars = step.event.toolResultChars;
  if (!toolResultChars) return [];
  if (toolResultChars.chars <= FAT_TOOL_RESULT_CHARS) return [];
  const toolName = toolResultChars.toolName ?? "工具";
  return [
    {
      sessionId: stats.sessionId,
      kind: "fat-tool-result",
      at: step.event.timestamp ?? new Date().toISOString(),
      message: `重跑剛剛那個 ${toolName} 呼叫，加上 head/grep/limit 把輸出縮小（原本回傳了 ${toolResultChars.chars.toLocaleString("en-US")} 字元）。`,
    },
  ];
}

export function detect(prev: SessionUsageStats, next: SessionUsageStats, steps: AccumulateStep[]): Advice[] {
  const advice: Advice[] = [];
  for (const step of steps) {
    advice.push(...checkLongSession(step.statsBefore, step.statsAfter));
    advice.push(...checkCacheSpike(step.statsBefore, step));
    advice.push(...checkHeavyBaseline(step.statsBefore, step));
    advice.push(...checkFatToolResult(step.statsAfter, step));
  }
  return advice;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/usage/detect.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/usage/detect.ts src/usage/detect.test.ts
git commit -m "$(cat <<'EOF'
Add the four usage detectors

Each detector inspects the before/after stats around one accepted
event and, when its fixed threshold is crossed, emits a single Advice
whose message is one concrete action (with the triggering numbers
appended), matching the spec's four patterns: long-session,
cache-spike, fat-tool-result, heavy-baseline.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: In-memory tail runtime

**Files:**
- Create: `src/usage/tail-runtime.ts`
- Test: `src/usage/tail-runtime.test.ts`

**Interfaces:**
- Consumes: `createTailState`, `parseNewContent` (Task 1); `accumulate` (Task 2); `detect` (Task 3); `createSessionUsageStats`, `Advice`, `SessionUsageStats`, `TailState` (Task 1).
- Produces: `prime(sessionId: string, transcriptPath: string): { stats: SessionUsageStats; advice: Advice[] }`, `refresh(sessionId: string, transcriptPath: string): Advice[]`, `forget(sessionId: string): void`.

- [ ] **Step 1: Write failing tests**

Create `src/usage/tail-runtime.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forget, prime, refresh } from "./tail-runtime.js";

function assistantLine(id: string, cacheCreation: number): string {
  return JSON.stringify({
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      id,
      usage: { cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: 0, output_tokens: 0 },
      content: [{ type: "text", text: "hi" }],
    },
  });
}

test("prime + 連續 refresh 分批寫入的結果，累積統計正確且不重算已讀內容", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-a`;
  try {
    writeFileSync(path, assistantLine("m0", 60001) + "\n"); // 觸發 heavy-baseline
    const primed = prime(sessionId, path);
    assert.equal(primed.stats.mainThreadMsgCount, 1);
    assert.equal(primed.advice.some((a) => a.kind === "heavy-baseline"), true);

    appendFileSync(path, assistantLine("m1", 10) + "\n");
    const afterAppend = refresh(sessionId, path);
    assert.equal(afterAppend.length, 0);

    const noNewContent = refresh(sessionId, path);
    assert.deepEqual(noNewContent, []);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh 對還沒 prime 過的 session 會自動先 prime", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-b`;
  try {
    writeFileSync(path, assistantLine("m0", 100) + "\n");
    const advice = refresh(sessionId, path);
    assert.equal(Array.isArray(advice), true);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prime 對不存在的檔案回傳空狀態，不拋錯", () => {
  const sessionId = `test-missing-${Date.now()}`;
  const result = prime(sessionId, "/nonexistent/path/session.jsonl");
  assert.equal(result.stats.mainThreadMsgCount, 0);
  assert.deepEqual(result.advice, []);
  forget(sessionId);
});

test("forget 之後同一個 sessionId 的下一次 refresh 等同重新 prime", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-advisor-"));
  const path = join(dir, "session.jsonl");
  const sessionId = `test-${Date.now()}-c`;
  try {
    writeFileSync(path, assistantLine("m0", 60001) + "\n");
    prime(sessionId, path);
    forget(sessionId);
    const advice = refresh(sessionId, path); // 內部沒有紀錄了，等同從頭 prime
    assert.equal(advice.some((a) => a.kind === "heavy-baseline"), true);
  } finally {
    forget(sessionId);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/usage/tail-runtime.test.ts`
Expected: FAIL — `./tail-runtime.js` does not exist yet.

- [ ] **Step 3: Implement `src/usage/tail-runtime.ts`**

```ts
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { accumulate } from "./accumulate.js";
import { detect } from "./detect.js";
import { createTailState, parseNewContent } from "./tail-transcript.js";
import { Advice, createSessionUsageStats, SessionUsageStats, TailState } from "./types.js";

interface RuntimeEntry {
  tailState: TailState;
  stats: SessionUsageStats;
}

const sessions = new Map<string, RuntimeEntry>();

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function readNewBytes(path: string, offset: number, size: number): string {
  if (size <= offset) return "";
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, offset);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf-8");
}

function runOnce(
  prevTailState: TailState,
  prevStats: SessionUsageStats,
  content: string,
): { tailState: TailState; stats: SessionUsageStats; advice: Advice[] } {
  const parsed = parseNewContent(content, prevTailState);
  const { next, steps } = accumulate(prevStats, parsed.events);
  const advice = detect(prevStats, next, steps);
  return { tailState: parsed.state, stats: next, advice };
}

export function prime(sessionId: string, transcriptPath: string): { stats: SessionUsageStats; advice: Advice[] } {
  const stats0 = createSessionUsageStats(sessionId);
  const size = fileSize(transcriptPath);
  if (size === undefined) {
    sessions.set(sessionId, { tailState: createTailState(), stats: stats0 });
    return { stats: stats0, advice: [] };
  }
  const content = readNewBytes(transcriptPath, 0, size);
  const result = runOnce(createTailState(), stats0, content);
  sessions.set(sessionId, { tailState: result.tailState, stats: result.stats });
  return { stats: result.stats, advice: result.advice };
}

export function refresh(sessionId: string, transcriptPath: string): Advice[] {
  const entry = sessions.get(sessionId);
  if (!entry) return prime(sessionId, transcriptPath).advice;

  const size = fileSize(transcriptPath);
  if (size === undefined) return [];
  if (size < entry.tailState.offset) return prime(sessionId, transcriptPath).advice; // 檔案被截斷/換新，視同重新開始
  if (size === entry.tailState.offset) return [];

  const content = readNewBytes(transcriptPath, entry.tailState.offset, size);
  const result = runOnce(entry.tailState, entry.stats, content);
  sessions.set(sessionId, { tailState: result.tailState, stats: result.stats });
  return result.advice;
}

export function forget(sessionId: string): void {
  sessions.delete(sessionId);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/usage/tail-runtime.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/usage/tail-runtime.ts src/usage/tail-runtime.test.ts
git commit -m "$(cat <<'EOF'
Add in-memory tail runtime (prime/refresh/forget)

Wraps the pure parse/accumulate/detect pipeline behind a per-session
in-memory Map. prime() reads a transcript once in full (so opening
watch mid-session still catches an already-long session); refresh()
reads only the bytes appended since the last call via fs.readSync.
Both fail open on missing/shrunk files instead of throwing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Session grouping for the advice panel

**Files:**
- Modify: `src/session-preference.ts` (export `shortSessionId`; add optional `activitySummary` to `SessionHint`)
- Modify: `src/session-preference.test.ts` (one new test for the now-public `shortSessionId`)
- Create: `src/usage/advice-groups.ts`
- Test: `src/usage/advice-groups.test.ts`

**Interfaces:**
- Consumes: `groupSessionsByProject`, `sameCwd`, `SessionHint` (extended, from `session-preference.js`); `Advice` (Task 1).
- Produces: `shortSessionId(sessionId: string): string` (now exported from `session-preference.js`); `AdviceProjectGroup`, `groupAdviceByProject(advice: readonly Advice[], sessions: readonly SessionHint[], watchCwd: string): AdviceProjectGroup[]` (from `advice-groups.js`).

- [ ] **Step 1: Export `shortSessionId` and extend `SessionHint`**

In `src/session-preference.ts`, change:

```ts
export interface SessionHint {
  sessionId: string;
  cwd?: string;
  updatedAt: string;
}
```

to:

```ts
export interface SessionHint {
  sessionId: string;
  cwd?: string;
  updatedAt: string;
  /** 該 session 目前的活動摘要（TaskState.activity.summary），只有用量建議面板需要顯示時才會帶。 */
  activitySummary?: string;
}
```

and change:

```ts
function shortSessionId(sessionId: string): string {
```

to:

```ts
export function shortSessionId(sessionId: string): string {
```

- [ ] **Step 2: Add a direct test for `shortSessionId`**

In `src/session-preference.test.ts`, add near the other tests:

```ts
test("shortSessionId 超過 8 碼才截斷，否則原樣回傳", () => {
  assert.equal(shortSessionId("abcdefgh12345"), "abcdefgh");
  assert.equal(shortSessionId("short"), "short");
});
```

At the top of `src/session-preference.test.ts`, change:

```ts
import {
  addedSessionIds,
  formatNewSessionNotice,
  groupSessionsByProject,
  pickPreferredSession,
  projectChoices,
  sessionChoices,
  sessionChoicesInProject,
  shouldAutoSelectSession,
} from "./session-preference.js";
```

to:

```ts
import {
  addedSessionIds,
  formatNewSessionNotice,
  groupSessionsByProject,
  pickPreferredSession,
  projectChoices,
  sessionChoices,
  sessionChoicesInProject,
  shortSessionId,
  shouldAutoSelectSession,
} from "./session-preference.js";
```

- [ ] **Step 3: Run session-preference tests to verify they still pass**

Run: `node --import tsx --test src/session-preference.test.ts`
Expected: PASS (existing tests untouched, new test green).

- [ ] **Step 4: Write failing tests for `groupAdviceByProject`**

Create `src/usage/advice-groups.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { SessionHint } from "../session-preference.js";
import { Advice } from "./types.js";
import { groupAdviceByProject } from "./advice-groups.js";

const hints: SessionHint[] = [
  { sessionId: "session-aaa11111", cwd: "/proj/a", updatedAt: "2026-09-15T01:00:00.000Z", activitySummary: "正在讀取 src/foo.ts" },
  { sessionId: "session-bbb22222", cwd: "/proj/b", updatedAt: "2026-09-15T02:00:00.000Z" },
  { sessionId: "session-ccc33333", cwd: "/proj/a", updatedAt: "2026-09-15T03:00:00.000Z" },
];

test("groupAdviceByProject 只保留有 advice 的 session，依專案分組", () => {
  const advice: Advice[] = [
    { sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:05:00.000Z", message: "m1" },
    { sessionId: "session-ccc33333", kind: "fat-tool-result", at: "2026-09-15T03:05:00.000Z", message: "m3" },
  ];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "a");
  assert.equal(groups[0].sessions.length, 2);
  assert.equal(groups[0].sessions.every((s) => s.advice.length === 1), true);
});

test("groupAdviceByProject 帶出 shortId、isCurrent、activitySummary", () => {
  const advice: Advice[] = [{ sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:05:00.000Z", message: "m1" }];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  const session = groups[0].sessions[0];
  assert.equal(session.shortId, "session-");
  assert.equal(session.isCurrent, true);
  assert.equal(session.activitySummary, "正在讀取 src/foo.ts");
});

test("groupAdviceByProject 不是目前 cwd 的 session，isCurrent 是 false", () => {
  const advice: Advice[] = [{ sessionId: "session-bbb22222", kind: "cache-spike", at: "2026-09-15T02:05:00.000Z", message: "m2" }];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  assert.equal(groups[0].sessions[0].isCurrent, false);
});

test("groupAdviceByProject 同一個 session 的 advice 依時間新到舊排序", () => {
  const advice: Advice[] = [
    { sessionId: "session-aaa11111", kind: "long-session", at: "2026-09-15T01:00:00.000Z", message: "old" },
    { sessionId: "session-aaa11111", kind: "cache-spike", at: "2026-09-15T01:05:00.000Z", message: "new" },
  ];
  const groups = groupAdviceByProject(advice, hints, "/proj/a");
  const session = groups[0].sessions.find((s) => s.sessionId === "session-aaa11111");
  assert.equal(session?.advice[0].message, "new");
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `node --import tsx --test src/usage/advice-groups.test.ts`
Expected: FAIL — `./advice-groups.js` does not exist yet.

- [ ] **Step 6: Implement `src/usage/advice-groups.ts`**

```ts
import { groupSessionsByProject, sameCwd, SessionHint, shortSessionId } from "../session-preference.js";
import { Advice } from "./types.js";

export interface AdviceSession {
  sessionId: string;
  shortId: string;
  isCurrent: boolean;
  activitySummary: string | undefined;
  advice: Advice[];
}

export interface AdviceProjectGroup {
  key: string;
  label: string;
  sessions: AdviceSession[];
}

export function groupAdviceByProject(
  advice: readonly Advice[],
  sessions: readonly SessionHint[],
  watchCwd: string,
): AdviceProjectGroup[] {
  const advisedSessionIds = new Set(advice.map((a) => a.sessionId));
  const relevant = sessions.filter((session) => advisedSessionIds.has(session.sessionId));
  const groups = groupSessionsByProject(relevant, watchCwd);

  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    sessions: group.sessions.map((session) => ({
      sessionId: session.sessionId,
      shortId: shortSessionId(session.sessionId),
      isCurrent: sameCwd(session.cwd, watchCwd),
      activitySummary: relevant.find((s) => s.sessionId === session.sessionId)?.activitySummary,
      advice: advice.filter((a) => a.sessionId === session.sessionId).sort((left, right) => right.at.localeCompare(left.at)),
    })),
  }));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --import tsx --test src/usage/advice-groups.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/session-preference.ts src/session-preference.test.ts src/usage/advice-groups.ts src/usage/advice-groups.test.ts
git commit -m "$(cat <<'EOF'
Add advice grouping keyed off existing session grouping

groupAdviceByProject reuses groupSessionsByProject to bucket advice by
project the same way the session picker already does, and attaches
per-session identification (short id, current-cwd marker, latest
activity summary) so a row is recognizable without cross-referencing
the raw session id.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Advice panel UI component

**Files:**
- Create: `src/ui/AdvicePanel.tsx`

**Interfaces:**
- Consumes: `AdviceProjectGroup` (Task 5); `clampScrollOffset`, `pageSizeFromTerminal`, `visibleSlice` (existing `src/ui/scroll-window.js`).
- Produces: `AdvicePanel({ groups }: { groups: AdviceProjectGroup[] })` React component.

No automated test for this file — the project doesn't have an Ink component-testing dependency and no existing `src/ui/*.tsx` file has one (`src/ui/scroll-window.test.ts` only tests the plain-function helper, not a component). This task's verification is the typecheck in Step 2 plus the manual run in Task 7 once it's wired up.

- [ ] **Step 1: Implement `src/ui/AdvicePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { AdviceProjectGroup } from "../usage/advice-groups.js";
import { clampScrollOffset, pageSizeFromTerminal, visibleSlice } from "./scroll-window.js";

const PANEL_CHROME_ROWS = 6;

interface AdviceRow {
  project: string;
  sessionId: string;
  shortId: string;
  isCurrent: boolean;
  activitySummary: string | undefined;
  kind: string;
  message: string;
}

function flattenRows(groups: AdviceProjectGroup[]): AdviceRow[] {
  return groups.flatMap((group) =>
    group.sessions.flatMap((session) =>
      session.advice.map((advice) => ({
        project: group.label,
        sessionId: session.sessionId,
        shortId: session.shortId,
        isCurrent: session.isCurrent,
        activitySummary: session.activitySummary,
        kind: advice.kind,
        message: advice.message,
      })),
    ),
  );
}

export function AdvicePanel({ groups }: { groups: AdviceProjectGroup[] }) {
  const { isRawModeSupported } = useStdin();
  const [termRows, setTermRows] = useState(process.stdout.rows ?? 24);
  const [offset, setOffset] = useState(0);
  const rows = flattenRows(groups);
  const pageSize = pageSizeFromTerminal(termRows, PANEL_CHROME_ROWS);
  const start = clampScrollOffset(offset, rows.length, pageSize);
  const visible = visibleSlice(rows, start, pageSize);
  const hiddenBelow = Math.max(0, rows.length - start - visible.length);

  useEffect(() => {
    const onResize = () => setTermRows(process.stdout.rows ?? 24);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOffset((currentOffset) => clampScrollOffset(currentOffset, rows.length, pageSize));
  }, [rows.length, pageSize]);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset + 1, rows.length, pageSize));
      }
      if (input === "k" || key.upArrow) {
        setOffset((currentOffset) => clampScrollOffset(currentOffset - 1, rows.length, pageSize));
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>目前沒有用量建議。</Text>
        <Box marginTop={1}>
          <Text dimColor>按 b 回上一頁</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>用量建議</Text>
      </Box>
      {start > 0 ? <Text dimColor>↑ 還有 {start} 則</Text> : null}
      {visible.map((row, index) => (
        <Box key={`${row.sessionId}-${row.kind}-${index}`} flexDirection="column" marginBottom={1}>
          <Text dimColor>
            {row.project} · {row.shortId}
            {row.isCurrent ? " (目前)" : ""}
            {row.activitySummary ? ` · ${row.activitySummary}` : ""}
          </Text>
          <Text color="yellow">⚠ {row.message}</Text>
        </Box>
      ))}
      {hiddenBelow > 0 ? <Text dimColor>↓ 還有 {hiddenBelow} 則</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>↑↓ 捲動 — 按 b 回上一頁</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/AdvicePanel.tsx
git commit -m "$(cat <<'EOF'
Add AdvicePanel component

Presentational, scrollable list of advice grouped by project/session
(mirrors SessionPicker/TaskList's scroll-window usage). Each row shows
project · short session id · (目前) marker · latest activity summary,
so a row is identifiable without looking up the raw session id, then
the advice message. Wired into App.tsx in the next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire cross-session monitoring into App.tsx

**Files:**
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `prime`, `refresh`, `forget` (Task 4); `groupAdviceByProject` (Task 5); `AdvicePanel` (Task 6); `Advice` (Task 1); existing `readTaskState`, `chokidar`, `join`.

- [ ] **Step 1: Add imports and the advice/view state**

`src/ui/App.tsx` already imports `useEffect, useRef, useState` from `"react"` and `chokidar` — no change needed to either of those lines. Add these new imports below the existing `import { TaskList } from "./TaskList.js";` / `import { SessionPicker } from "./SessionPicker.js";` lines:

```ts
import { AdvicePanel } from "./AdvicePanel.js";
import { groupAdviceByProject } from "../usage/advice-groups.js";
import { forget, prime, refresh } from "../usage/tail-runtime.js";
import { Advice } from "../usage/types.js";
```

Inside the `App` function body, alongside the existing `useState`/`useRef` declarations, add:

```ts
const [view, setView] = useState<"main" | "advice">("main");
const [adviceList, setAdviceList] = useState<Advice[]>([]);
const adviceWatchers = useRef<Map<string, ReturnType<typeof chokidar.watch>>>(new Map());
```

Add a module-level constant near the top of the file (outside the component), alongside other top-level helpers:

```ts
const MAX_ADVICE = 50;

function formatAdviceNotice(newAdvice: Advice[]): string {
  return newAdvice.length === 1 ? "有新的用量建議 — 按 a 查看" : `有 ${newAdvice.length} 則新的用量建議 — 按 a 查看`;
}
```

- [ ] **Step 2: Extend `hintsFor` to carry activity summary**

Change the existing `hintsFor` function:

```ts
function hintsFor(sessionIds: string[]): SessionHint[] {
  return sessionIds.flatMap((sessionId) => {
    const state = readTaskState(sessionId);
    if (!state) return [];
    return [{ sessionId: state.sessionId, cwd: state.cwd, updatedAt: state.updatedAt }];
  });
}
```

to:

```ts
function hintsFor(sessionIds: string[]): SessionHint[] {
  return sessionIds.flatMap((sessionId) => {
    const state = readTaskState(sessionId);
    if (!state) return [];
    return [
      {
        sessionId: state.sessionId,
        cwd: state.cwd,
        updatedAt: state.updatedAt,
        activitySummary: state.activity?.summary,
      },
    ];
  });
}
```

- [ ] **Step 3: Add the cross-session transcript watcher effect**

Add this new `useEffect` next to the other `useEffect`s in `App` (after the "監控 state 目錄" effect that maintains `sessionIds` is fine):

```ts
// 對每個已知 session 的 transcript 檔案掛用量分析（不限正在看的那個），
// 只在 sessionId 第一次出現時 prime，session 消失時才 forget + 關 watcher。
useEffect(() => {
  const watchers = adviceWatchers.current;
  const current = new Set(sessionIds);

  const applyAdvice = (newAdvice: Advice[]) => {
    if (newAdvice.length === 0) return;
    setAdviceList((prev) => [...newAdvice, ...prev].slice(0, MAX_ADVICE));
    setNotice(formatAdviceNotice(newAdvice));
    try {
      process.stdout.write("\x07");
    } catch {
      // 終端機不支援鈴就略過
    }
  };

  for (const sessionId of sessionIds) {
    if (watchers.has(sessionId)) continue;
    const state = readTaskState(sessionId);
    if (!state?.claudeSessionDir) continue;
    const transcriptPath = join(state.claudeSessionDir, `${sessionId}.jsonl`);

    try {
      applyAdvice(prime(sessionId, transcriptPath).advice);
    } catch {
      // 用量分析出任何錯誤都不能拖垮主畫面
    }

    const watcher = chokidar.watch(transcriptPath, { ignoreInitial: true, ignorePermissionErrors: true });
    watcher.on("change", () => {
      try {
        applyAdvice(refresh(sessionId, transcriptPath));
      } catch {
        // 同上
      }
    });
    watchers.set(sessionId, watcher);
  }

  for (const [sessionId, watcher] of [...watchers.entries()]) {
    if (current.has(sessionId)) continue;
    void watcher.close();
    watchers.delete(sessionId);
    forget(sessionId);
  }
}, [sessionIds]);

useEffect(() => {
  return () => {
    for (const watcher of adviceWatchers.current.values()) void watcher.close();
    adviceWatchers.current.clear();
  };
}, []);
```

- [ ] **Step 4: Add the `a` key binding and advice-view render branch**

In the existing top `useInput` handler, change:

```ts
useInput(
  (input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (input !== "b" && !key.escape) return;
    if (selectedSessionId) {
      setSelectedSessionId(undefined);
      setProjectKey(undefined);
      setTaskState(null);
      setBrowsing(true);
      setNotice(undefined);
      return;
    }
    if (projectKey) setProjectKey(undefined);
  },
  { isActive: Boolean(isRawModeSupported) },
);
```

to:

```ts
useInput(
  (input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (input === "a" && view === "main") {
      setView("advice");
      return;
    }
    if (input !== "b" && !key.escape) return;
    if (view === "advice") {
      setView("main");
      return;
    }
    if (selectedSessionId) {
      setSelectedSessionId(undefined);
      setProjectKey(undefined);
      setTaskState(null);
      setBrowsing(true);
      setNotice(undefined);
      return;
    }
    if (projectKey) setProjectKey(undefined);
  },
  { isActive: Boolean(isRawModeSupported) },
);
```

Then, immediately before the existing `if (!selectedSessionId) { ... }` block near the end of the component, add:

```tsx
if (view === "advice") {
  const groups = groupAdviceByProject(adviceList, hintsFor(sessionIds), cwd);
  return withNotice(notice, <AdvicePanel groups={groups} />);
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual end-to-end verification**

There's no automated UI test in this project (see Task 6) — verify by hand with a scripted fixture pointed at an isolated state dir via the existing `CLAUDE_TASK_TRACKER_DIR` override (`src/store.ts`):

```bash
# 1. Build once so `watch` runs the real dist output.
cd /Users/jinze.huang/Documents/gogo/claude-code-task-tracker
npm run build

# 2. Set up an isolated fixture.
FIXTURE_DIR=$(mktemp -d)
export CLAUDE_TASK_TRACKER_DIR="$FIXTURE_DIR/state"
mkdir -p "$CLAUDE_TASK_TRACKER_DIR"
TRANSCRIPT_DIR="$FIXTURE_DIR/transcript"
mkdir -p "$TRANSCRIPT_DIR"
SESSION_ID="fixture-session-0001"

# Task-tracker's own state file for this session (what `watch` reads to find sessionIds + claudeSessionDir).
cat > "$CLAUDE_TASK_TRACKER_DIR/$SESSION_ID.json" <<JSON
{
  "sessionId": "$SESSION_ID",
  "cwd": "$FIXTURE_DIR/fake-project",
  "claudeSessionDir": "$TRANSCRIPT_DIR",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "activity": { "toolName": "Read", "phase": "done", "summary": "正在讀取 src/foo.ts", "at": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" }
}
JSON

# A transcript whose first (and only) turn already crosses the heavy-baseline threshold (>50000).
node -e '
const line = JSON.stringify({
  isSidechain: false,
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    id: "m0",
    usage: { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 10 },
    content: [{ type: "text", text: "hi" }],
  },
});
require("fs").writeFileSync(process.argv[1], line + "\n");
' "$TRANSCRIPT_DIR/$SESSION_ID.jsonl"

# 3. Run watch. The fixture's cwd ($FIXTURE_DIR/fake-project) does not match the
#    real cwd, so it opens on the project picker — letting you see the cross-session
#    banner+bell fire for a session you are not looking at.
node dist/cli.js watch
```

Confirm, in order:

1. On startup, the terminal bell rings and a yellow banner reading `有新的用量建議 — 按 a 查看` appears above the project picker (this is `prime()` firing on first sight of the fixture session, immediately, because the file already crosses the heavy-baseline threshold — this is the "watch opened mid-session" case from the spec).
2. Press `a`: the Advice panel opens, showing a row like `fake-project · fixture- · 正在讀取 src/foo.ts` (no `(目前)` since the fixture cwd doesn't match your real cwd) followed by `⚠ 執行 task-tracker inspect 檢查這個專案載入 prompt 的東西（這個 session 開場第一輪就吃了 60,000 token）。`.
3. Press `b`: returns to the project picker.
4. In a second terminal, append a normal-sized turn so it does not cross any threshold:

   ```bash
   node -e '
   const line = JSON.stringify({
     isSidechain: false,
     timestamp: new Date().toISOString(),
     message: {
       role: "assistant",
       id: "m1",
       usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
       content: [{ type: "text", text: "ok" }],
     },
   });
   require("fs").appendFileSync(process.argv[1], line + "\n");
   ' "$TRANSCRIPT_DIR/$SESSION_ID.jsonl"
   ```

   Within a second or two the bell should NOT ring again (no new advice), confirming `refresh()` doesn't re-fire old advice.
5. `Ctrl+C` to quit `watch`, then `rm -rf "$FIXTURE_DIR"` and `unset CLAUDE_TASK_TRACKER_DIR`.

- [ ] **Step 7: Run the full test suite**

Run: `npm test && npm run typecheck`
Expected: PASS (this task added no new automated tests, so this just guards against regressions in the modules it wired together).

- [ ] **Step 8: Commit**

```bash
git add src/ui/App.tsx
git commit -m "$(cat <<'EOF'
Wire cross-session usage monitoring into App.tsx

Every known session (not just the one being viewed) gets a transcript
watcher: prime() on first sight, refresh() on each file change,
forget() when the session disappears. New advice reuses the existing
new-session notice+bell banner and is reachable any time via the new
`a` key, which opens AdvicePanel; `b`/Esc returns to whatever was
showing before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Version bump, README docs, final verification

**Files:**
- Modify: `package.json` (`version`)
- Modify: `README.md`

**Interfaces:** None (docs + metadata only).

- [ ] **Step 1: Bump the version**

In `package.json`, change:

```json
  "version": "0.9.0",
```

to:

```json
  "version": "0.10.0",
```

- [ ] **Step 2: Update README's version line**

In `README.md`, change:

```markdown
目前版本：**v0.9.0**。套件頁：[npm](https://www.npmjs.com/package/claude-code-task-tracker)。
```

to:

```markdown
目前版本：**v0.10.0**。套件頁：[npm](https://www.npmjs.com/package/claude-code-task-tracker)。
```

- [ ] **Step 3: Document the advice panel in README**

Find this paragraph (around the multi-session behavior description):

```markdown
若同時有多個 session 在跑，`watch` 會優先自動選目前工作目錄對得上的那一個，標題旁標「目前」。
對不上才依專案列出選單，再選該專案底下的 session。觀看途中按 `b` 可隨時回到專案列表。
若之後又出現新 session，畫面上方會提示並響鈴，但不會自動切走目前正在看的那一個；按 `b` 回列表後提示會消失。也可以直接指定：
```

Add a new paragraph immediately after it (before the ` ```task-tracker watch --session <session_id>``` ` code block that follows):

```markdown
`watch` 也會持續分析每個已知 session 的 token 用量（讀 Claude Code 自己寫的 session transcript，
不限目前正在看的那個），偵測到「session 拖太長」「單輪 cache 重算暴增」「單次工具回傳過肥」
「開場底子就重」這四種狀況時，會用同一套提示 + 響鈴機制通知你，並直接告訴你現在該做的動作
（例如 `/clear`、開新 session、或加 `head`/`limit` 重跑）。按 `a` 隨時查看目前所有建議，`b` 回上一頁。
```

- [ ] **Step 4: Add the `a` key to the keybinding summary**

Find:

```markdown
畫面內按 `q` 離開、按 `b` 回專案列表、↑↓ 在清單裡捲動（一次一頁視窗，不會整份往下刷）。活動列直接顯示那句話，例如 `◐ 正在讀取 src/schema.ts`；結束後變成
`已讀取 src/schema.ts`。不再前置工具名，也不顯示原始指令。
```

Change to:

```markdown
畫面內按 `q` 離開、按 `b` 回專案列表、按 `a` 查看用量建議、↑↓ 在清單裡捲動（一次一頁視窗，不會整份往下刷）。活動列直接顯示那句話，例如 `◐ 正在讀取 src/schema.ts`；結束後變成
`已讀取 src/schema.ts`。不再前置工具名，也不顯示原始指令。
```

- [ ] **Step 5: Update the project structure tree**

Find:

```markdown
└── ui/
    ├── App.tsx               # 主畫面，負責 session 偵測與檔案監控
    ├── SessionPicker.tsx     # 多 session 時的選單
    ├── TaskList.tsx          # task 清單、活動句與進度條
    ├── InspectApp.tsx        # inspect 的互動
    └── InspectView.tsx       # inspect 的排版
```

Change to:

```markdown
├── usage/                    # 跨 session 用量分析（tail transcript、偵測、建議文字）
└── ui/
    ├── App.tsx               # 主畫面，負責 session 偵測、檔案監控與用量建議通知
    ├── SessionPicker.tsx     # 多 session 時的選單
    ├── TaskList.tsx          # task 清單、活動句與進度條
    ├── AdvicePanel.tsx       # 用量建議面板
    ├── InspectApp.tsx        # inspect 的互動
    └── InspectView.tsx       # inspect 的排版
```

- [ ] **Step 6: Final full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS — all tests green, no type errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md
git commit -m "$(cat <<'EOF'
Bump to v0.10.0 and document the usage advisor

New feature, minor version bump per project convention. README now
covers the four detectors, the `a` key, and the new src/usage/ +
AdvicePanel.tsx entries in the project structure.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
