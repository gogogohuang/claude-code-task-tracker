# Codex 支援與來源分頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `task-tracker` 能追蹤 Codex session 的活動句（階段 A），並在 `watch` 提供 Claude／Codex／Cursor 分頁檢視（階段 B）。

**Architecture:** hook 以 `--agent codex` 參數得知來源，狀態檔加 optional `agent` 欄位（缺省視為 claude，舊檔免遷移）。安裝端用 agent profile 決定寫哪個檔、註冊哪些事件。分頁在 `watch` 端只做「依 `agent` 過濾 session 清單」，既有 picker／split 流程不改內部邏輯。

**Tech Stack:** TypeScript（ESM）、zod、ink 5 + React 18、ink-select-input 6、`node:test`（`pnpm test`）、pnpm 9.11。

**Spec:**
- `docs/superpowers/specs/2026-09-19-codex-support-design.md`（含「Phase 0 結果」，覆蓋該文較早段落）
- `docs/superpowers/specs/2026-09-19-agent-tabs-design.md`
- 真實 payload fixture：`src/fixtures/codex-0.155.1-hook-samples.jsonl`

## Global Constraints

- 狀態目錄維持 `~/.claude-task-tracker`；套件名與 bin 名不變（`claude-code-task-tracker`／`task-tracker`）。
- `TaskState.agent` 為 optional，**只有 Codex 才寫入 `"codex"`**；Claude session 的狀態檔內容與現在完全相同（不寫 `agent`）。讀取端一律 `agent ?? "claude"`。
- Claude 的 `init` 行為、輸出、寫入的 hook 命令字串都不變（既有使用者重跑 `init` 必須維持 `already`）。
- Codex hook 命令格式：`"<node>" "<~/.claude-task-tracker/task-tracker-hook.js>" --agent codex`；註冊事件只有 `SessionStart`／`PreToolUse`／`PostToolUse`，**不設 matcher**。
- 不自己寫 `~/.codex/config.toml` 的 `[hooks.state]`／`trusted_hash`；`init --agent codex` 只提示使用者在 Codex hooks review 核可。
- 不存原始指令全文、patch 內容或 prompt（活動句原則不變）。
- 第一版只做活動句：`update_plan` 不存在，任務清單擱置；Cursor 只留分頁、顯示「尚未支援」。
- 分頁切換鍵只用 `Tab`／`Shift+Tab`：`ink-select-input` 會攔截 `1`–`9` 數字鍵（`node_modules/ink-select-input/build/SelectInput.js:54`），不能用來切分頁。
- 不升版本（依 `CLAUDE.md`，合併後再 `pnpm version minor`）。測試過的 Codex 版本註明為 0.155.1。
- 每個 task 結束前跑 `pnpm typecheck` 與 `pnpm test`。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/agent.ts` | 新增 | `Agent`／`TabAgent` 型別、`agentOf`、`parseAgentArg`、分頁常數、Codex 未支援提示 |
| `src/codex-config.ts` | 新增 | 判斷 `~/.codex/config.toml` 是否明確關閉 hooks |
| `src/agent-tabs.ts` | 新增 | 分頁純邏輯：切換、彙總（數量、待處理）、標籤格式、是否可切換 |
| `src/ui/AgentTabs.tsx` | 新增 | 分頁列元件（只負責畫） |
| `src/schema.ts` | 修改 | `TaskState.agent` |
| `src/install-hooks.ts` | 修改 | agent profile：路徑、事件、命令、偵測 |
| `src/commands/init.ts`、`src/cli.tsx` | 修改 | `init --agent` |
| `src/hook/task-tracker-hook.ts`、`src/hook/apply-event.ts` | 修改 | 讀 `--agent`，Codex 路徑 |
| `src/describe-activity.ts` | 修改 | `apply_patch` 活動句 |
| `src/session-preference.ts` | 修改 | `SessionHint.agent`、`filterSessionsByAgent`、匯出 `presenceForHint` |
| `src/ui/App.tsx` | 修改 | `activeAgent`、切換鍵、分頁列、Codex 停用提示 |
| `README.md` | 修改 | Codex 支援與分頁說明 |
| 對應 `*.test.ts` | 新增／修改 | 見各 task |

測試指令：單檔 `node --import tsx --test src/<name>.test.ts`；全部 `pnpm test`。

---

# 階段 A：Codex 第一版

### Task 1: Agent 型別與狀態檔欄位

**Files:**
- Create: `src/agent.ts`, `src/agent.test.ts`
- Modify: `src/schema.ts`（`TaskStateSchema`，約 143 行）

**Interfaces:**
- Produces: `Agent = "claude" | "codex"`；`AgentSchema`；`agentOf(state?: { agent?: Agent } | null): Agent`；`parseAgentArg(argv: readonly string[]): Agent`；`TAB_AGENTS`、`TabAgent`、`TAB_LABELS`；`CODEX_UNSUPPORTED_NOTICE: string`。`TaskState.agent?: Agent`。

- [ ] **Step 1: 寫失敗測試** `src/agent.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { agentOf, parseAgentArg, TAB_AGENTS } from "./agent.js";
import { TaskStateSchema } from "./schema.js";

test("agentOf 缺省視為 claude", () => {
  assert.equal(agentOf(undefined), "claude");
  assert.equal(agentOf(null), "claude");
  assert.equal(agentOf({}), "claude");
  assert.equal(agentOf({ agent: "codex" }), "codex");
});

test("parseAgentArg 只認 --agent codex，其餘一律 claude", () => {
  assert.equal(parseAgentArg(["node", "hook.js"]), "claude");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent", "codex"]), "codex");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent", "claude"]), "claude");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent", "bogus"]), "claude");
  assert.equal(parseAgentArg(["node", "hook.js", "--agent"]), "claude");
});

test("分頁順序固定為 claude、codex、cursor", () => {
  assert.deepEqual([...TAB_AGENTS], ["claude", "codex", "cursor"]);
});

test("TaskStateSchema 接受沒有 agent 的舊狀態檔與 agent=codex", () => {
  const base = { sessionId: "s1", updatedAt: "2026-09-19T00:00:00.000Z" };
  assert.equal(TaskStateSchema.safeParse(base).success, true);
  const codex = TaskStateSchema.safeParse({ ...base, agent: "codex" });
  assert.equal(codex.success, true);
  assert.equal(TaskStateSchema.safeParse({ ...base, agent: "bogus" }).success, false);
});
```

- [ ] **Step 2: 確認失敗**

Run: `node --import tsx --test src/agent.test.ts`
Expected: FAIL（找不到 `./agent.js`）

- [ ] **Step 3: 實作** `src/agent.ts`

```ts
import { z } from "zod";

/** 寫進狀態檔的來源。Claude 不寫這個欄位，缺省即 claude。 */
export const AgentSchema = z.enum(["claude", "codex"]);
export type Agent = z.infer<typeof AgentSchema>;

/** watch 分頁順序。cursor 只保留分頁，尚未接入。 */
export const TAB_AGENTS = ["claude", "codex", "cursor"] as const;
export type TabAgent = (typeof TAB_AGENTS)[number];
export const TAB_LABELS: Record<TabAgent, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
};

export const CODEX_UNSUPPORTED_NOTICE = "Codex session 尚未支援此檢視";

export function agentOf(state: { agent?: Agent } | null | undefined): Agent {
  return state?.agent ?? "claude";
}

/** hook 命令列 `--agent codex`；缺少、缺值或不認得的值一律當作 claude。 */
export function parseAgentArg(argv: readonly string[]): Agent {
  const index = argv.indexOf("--agent");
  const parsed = AgentSchema.safeParse(index >= 0 ? argv[index + 1] : undefined);
  return parsed.success ? parsed.data : "claude";
}
```

`src/schema.ts`：檔頭加 `import { AgentSchema } from "./agent.js";`，`TaskStateSchema` 的 `cwd` 下一行加：

```ts
  /** 狀態來源。只有 Codex 寫入 "codex"；缺省視為 claude（舊檔不需遷移）。 */
  agent: AgentSchema.optional(),
```

- [ ] **Step 4: 確認通過** — `node --import tsx --test src/agent.test.ts src/schema.test.ts`，Expected: PASS
- [ ] **Step 5: Commit** — `git add src/agent.ts src/agent.test.ts src/schema.ts && git commit -m "feat: 新增 Agent 型別與 TaskState.agent 欄位"`

---

### Task 2: 安裝端 agent profile

**Files:**
- Modify: `src/install-hooks.ts`
- Test: `src/install-hooks.test.ts`

**Interfaces:**
- Consumes: `Agent` from `src/agent.ts`
- Produces（皆新增的**選用**末位參數，預設 `"claude"`，既有呼叫端不用改）：
  `buildHookCommand(execPath, hookScriptPath, agent?: Agent)`、`settingsPathFor(scope, input, agent?)`、`mergeTrackerHooks(settings, hookCommand, agent?)`、`hasTrackerHookInstalled(scope, input, agent?)`、`installTrackerHooks({... agent?: Agent})`。

- [ ] **Step 1: 寫失敗測試**（附加到 `src/install-hooks.test.ts`；檔頭 import 補 `installTrackerHooks`、`mkdirSync`）

```ts
const CODEX_COMMAND = buildHookCommand("/usr/bin/node", "/home/me/.claude-task-tracker/task-tracker-hook.js", "codex");

test("buildHookCommand：claude 不變，codex 追加 --agent codex", () => {
  assert.equal(COMMAND.includes("--agent"), false);
  assert.equal(CODEX_COMMAND, `${COMMAND} --agent codex`);
  assert.equal(isTrackerHookCommand(CODEX_COMMAND), true);
});

test("settingsPathFor：codex 指向 ~/.codex/hooks.json 與 <cwd>/.codex/hooks.json", () => {
  const input = { home: "/h", cwd: "/p" };
  assert.equal(settingsPathFor("user", input, "codex"), join("/h", ".codex", "hooks.json"));
  assert.equal(settingsPathFor("project", input, "codex"), join("/p", ".codex", "hooks.json"));
  assert.equal(settingsPathFor("user", input), join("/h", ".claude", "settings.json"));
});

test("mergeTrackerHooks codex：只註冊 SessionStart／PreToolUse／PostToolUse，且不設 matcher", () => {
  const merged = mergeTrackerHooks({}, CODEX_COMMAND, "codex");
  assert.deepEqual(Object.keys(merged.hooks ?? {}).sort(), ["PostToolUse", "PreToolUse", "SessionStart"]);
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart"] as const) {
    const groups = merged.hooks?.[event];
    assert.equal(groups?.length, 1);
    assert.equal(groups?.[0].matcher, undefined);
    assert.deepEqual(groups?.[0].hooks, [{ type: "command", command: CODEX_COMMAND, timeout: 5 }]);
  }
});

test("mergeTrackerHooks codex：保留 TempoTerm、herdr 等既有 hook，重跑冪等", () => {
  const existing = {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: '"/Applications/TempoTerm.app/Contents/MacOS/tempo-term" --status-hook codex active' }] },
      ],
      SessionStart: [
        { hooks: [{ type: "command", command: "bash '/Users/me/.codex/herdr-agent-state.sh' session", timeout: 10 }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "tempo stop" }] }],
    },
  };
  const once = mergeTrackerHooks(existing, CODEX_COMMAND, "codex");
  const twice = mergeTrackerHooks(once, CODEX_COMMAND, "codex");
  assert.deepEqual(twice, once);
  assert.equal(once.hooks?.PreToolUse?.length, 2);
  assert.equal(once.hooks?.SessionStart?.length, 2);
  assert.deepEqual(once.hooks?.Stop, existing.hooks.Stop);
  assert.equal(once.hooks?.PreToolUse?.[0].hooks[0].command.includes("tempo-term"), true);
});

test("installTrackerHooks codex：寫入 ~/.codex/hooks.json，第二次回 already", () => {
  const root = mkdtempSync(join(tmpdir(), "tt-codex-"));
  try {
    const home = join(root, "home");
    const bundled = join(root, "bundled-hook.js");
    writeFileSync(bundled, "// hook");
    const input = {
      scope: "user" as const, home, cwd: root, execPath: "/usr/bin/node",
      bundledHookPath: bundled, stateDir: join(root, "state"), agent: "codex" as const,
    };
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "tempo stop" }] }] } }),
    );
    const first = installTrackerHooks(input);
    assert.deepEqual(first, { ok: true, settingsPath: join(home, ".codex", "hooks.json"), already: false });
    const written = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8"));
    assert.equal(written.hooks.Stop[0].hooks[0].command, "tempo stop");
    assert.equal(written.hooks.PreToolUse[0].hooks[0].command.endsWith("--agent codex"), true);
    const second = installTrackerHooks(input);
    assert.equal(second.ok && second.already, true);
    assert.equal(hasTrackerHookInstalled("user", { home, cwd: root }, "codex"), true);
    assert.equal(hasTrackerHookInstalled("user", { home, cwd: root }, "claude"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 確認失敗** — `node --import tsx --test src/install-hooks.test.ts`，Expected: FAIL（新測試型別／行為不符）

- [ ] **Step 3: 實作** `src/install-hooks.ts`

檔頭加 `import type { Agent } from "./agent.js";`。把固定的 `MATCHER_EVENTS`／`BARE_EVENTS` 換成 profile，並改下列函式：

```ts
type HookEvent = "PreToolUse" | "PostToolUse" | "SessionStart" | "TaskCreated" | "TaskCompleted";

interface AgentProfile {
  configDir: string;
  configFile: string;
  matcherEvents: readonly HookEvent[];
  bareEvents: readonly HookEvent[];
}

const AGENT_PROFILES: Record<Agent, AgentProfile> = {
  claude: {
    configDir: ".claude",
    configFile: "settings.json",
    matcherEvents: ["PreToolUse", "PostToolUse", "SessionStart"],
    bareEvents: ["TaskCreated", "TaskCompleted"],
  },
  // Codex 現有 hooks.json 條目都沒有 matcher；Task 系列事件 Codex 不存在。
  codex: {
    configDir: ".codex",
    configFile: "hooks.json",
    matcherEvents: [],
    bareEvents: ["SessionStart", "PreToolUse", "PostToolUse"],
  },
};

export function buildHookCommand(execPath: string, hookScriptPath: string, agent: Agent = "claude"): string {
  const base = `${JSON.stringify(execPath)} ${JSON.stringify(hookScriptPath)}`;
  return agent === "codex" ? `${base} --agent codex` : base;
}

export function settingsPathFor(
  scope: HookScope,
  input: { home: string; cwd: string },
  agent: Agent = "claude",
): string {
  const { configDir, configFile } = AGENT_PROFILES[agent];
  return join(scope === "user" ? input.home : input.cwd, configDir, configFile);
}

export function mergeTrackerHooks(settings: ClaudeSettings, hookCommand: string, agent: Agent = "claude"): ClaudeSettings {
  const profile = AGENT_PROFILES[agent];
  const hooks: NonNullable<ClaudeSettings["hooks"]> = { ...settings.hooks };
  for (const event of profile.matcherEvents) {
    hooks[event] = [...stripTrackerHooks(hooks[event]), trackerGroup(hookCommand, HOOK_MATCHER)];
  }
  for (const event of profile.bareEvents) {
    hooks[event] = [...stripTrackerHooks(hooks[event]), trackerGroup(hookCommand)];
  }
  return { ...settings, hooks };
}
```

`hasTrackerHookInstalled(scope, input, agent: Agent = "claude")` 內 `settingsPathFor(scope, input, agent)`。`installTrackerHooks` 的 input 加 `agent?: Agent`，函式內 `const agent = input.agent ?? "claude"`，`settingsPathFor(input.scope, input, agent)`、`buildHookCommand(input.execPath, installedHookPath(input.stateDir), agent)`、`mergeTrackerHooks(loaded.settings, hookCommand, agent)`。刪除不再使用的 `MATCHER_EVENTS`／`BARE_EVENTS`。

- [ ] **Step 4: 確認通過** — `node --import tsx --test src/install-hooks.test.ts`，Expected: 全部 PASS（含原有測試）
- [ ] **Step 5: Commit** — `git add src/install-hooks.ts src/install-hooks.test.ts && git commit -m "feat: install-hooks 支援 codex agent profile"`

---

### Task 3: `init --agent codex` 與信任提示

**Files:**
- Create: `src/codex-config.ts`, `src/codex-config.test.ts`
- Modify: `src/commands/init.ts`, `src/cli.tsx`（`init` 指令，約 32–38 行）

**Interfaces:**
- Consumes: `Agent`（Task 1）、`installTrackerHooks({agent})`（Task 2）
- Produces: `codexHooksDisabled(toml: string): boolean`；`codexConfigPath(home: string): string`；`runInit(scope?: HookScope, agent?: Agent): void`

- [ ] **Step 1: 寫失敗測試** `src/codex-config.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { codexHooksDisabled } from "./codex-config.js";

test("[features] 內 hooks = false 視為關閉", () => {
  assert.equal(codexHooksDisabled("[features]\njs_repl = false\nhooks = false\n"), true);
  assert.equal(codexHooksDisabled("[features]\n  hooks   =   false  # off\n"), true);
});

test("hooks = true、沒寫、或 false 出現在別的區段都不算關閉", () => {
  assert.equal(codexHooksDisabled("[features]\nhooks = true\n"), false);
  assert.equal(codexHooksDisabled("[features]\njs_repl = false\n"), false);
  assert.equal(codexHooksDisabled("[mcp_servers.x]\nhooks = false\n"), false);
  assert.equal(codexHooksDisabled(""), false);
});
```

- [ ] **Step 2: 確認失敗** — `node --import tsx --test src/codex-config.test.ts`，Expected: FAIL

- [ ] **Step 3: 實作**

`src/codex-config.ts`：

```ts
import { join } from "node:path";

export function codexConfigPath(home: string): string {
  return join(home, ".codex", "config.toml");
}

/** 只在 [features] 區段明確寫 `hooks = false` 才回 true；讀不懂一律 false（不擋安裝）。 */
export function codexHooksDisabled(toml: string): boolean {
  let section = "";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section === "features" && /^hooks\s*=\s*false\b/.test(line)) return true;
  }
  return false;
}
```

`src/commands/init.ts` 改為（保留 Claude 原輸出逐字不變）：

```ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Agent } from "../agent.js";
import { codexConfigPath, codexHooksDisabled } from "../codex-config.js";
import { STATE_DIR } from "../store.js";
import { HookScope, installTrackerHooks, resolveBundledHookPath } from "../install-hooks.js";

function codexNotes(home: string): string[] {
  const notes: string[] = [];
  const configPath = codexConfigPath(home);
  try {
    if (existsSync(configPath) && codexHooksDisabled(readFileSync(configPath, "utf-8"))) {
      notes.push(`注意：${configPath} 的 [features] 把 hooks 關掉了，請改成 hooks = true，否則 hook 不會執行。`);
    }
  } catch {
    // 讀不到就只是少一則提醒，不擋安裝
  }
  notes.push(
    "Codex 會要求核可新的 hook：請開啟 Codex，在啟動時的 hooks review 核可 task-tracker 的 hook。",
    "尚未核可前 hook 不會執行；`codex exec` 沒有核可畫面，需先在互動模式核可一次。",
    "已用 Codex 0.155.1 測試；目前只支援活動句，任務清單、用量、inspect 尚未支援 Codex。",
  );
  return notes;
}

export function runInit(scope: HookScope = "user", agent: Agent = "claude"): void {
  const home = homedir();
  const result = installTrackerHooks({
    scope, home, cwd: process.cwd(), execPath: process.execPath,
    bundledHookPath: resolveBundledHookPath(), stateDir: STATE_DIR, agent,
  });

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  if (result.already) {
    console.log("Hook 已經註冊過了，不需要重複設定。");
    if (agent === "codex") for (const note of codexNotes(home)) console.log(note);
    return;
  }

  console.log(`已將 task-tracker hook 寫入 ${result.settingsPath}`);
  console.log("Hook 腳本放在 ~/.claude-task-tracker/，不會綁死 npx 快取路徑。");
  if (scope === "user") {
    console.log(agent === "codex"
      ? "這是使用者層設定，之後任何專案的 Codex session 都會同步。"
      : "這是使用者層設定，之後任何專案的 Claude Code session 都會同步。");
  } else {
    console.log(agent === "codex"
      ? "之後在這個專案跑 Codex 時，目前活動會自動同步。"
      : "之後在這個專案跑 Claude Code 時，task 更新跟目前活動都會自動同步。");
  }
  console.log("執行 `task-tracker watch` 開始觀看即時進度。");
  console.log("");
  if (agent === "codex") {
    for (const note of codexNotes(home)) console.log(note);
    return;
  }
  console.log(
    "提醒：Sonnet 5 / Opus 4.8 等新版模型預設不帶 TodoWrite 工具，若要讓它產生 task，\n" +
      "請在啟動 Claude Code 前設定環境變數 CLAUDE_CODE_ENABLE_TODO_TOOLS=1。",
  );
}
```

`src/cli.tsx`：`init` 指令改為

```ts
program
  .command("init")
  .description("註冊 task-tracker hook（預設寫入 ~/.claude/settings.json；--agent codex 寫入 ~/.codex/hooks.json）")
  .option("--project", "改寫入目前專案的設定（.claude/settings.json 或 .codex/hooks.json）")
  .option("--agent <agent>", "要接哪個工具：claude（預設）｜codex", "claude")
  .action((opts: { project?: boolean; agent: string }) => {
    if (opts.agent !== "claude" && opts.agent !== "codex") {
      console.error(`不支援的 --agent：${opts.agent}（可用值：claude、codex）`);
      process.exitCode = 1;
      return;
    }
    runInit(opts.project ? "project" : "user", opts.agent);
  });
```

`watch` 的自動安裝維持只裝 Claude，不動。

- [ ] **Step 4: 驗證** — `node --import tsx --test src/codex-config.test.ts`（PASS）；`pnpm typecheck`（無錯）；手動：`HOME=$(mktemp -d) pnpm dev init --agent codex`（`pnpm dev` 需先 `pnpm build` 產生 bundled hook；若找不到 hook 腳本，先 `pnpm build`），確認寫入 `$HOME/.codex/hooks.json` 並印出核可提示；`pnpm dev init --agent bogus` 應報錯且 exit 1。
- [ ] **Step 5: Commit** — `git add src/codex-config.ts src/codex-config.test.ts src/commands/init.ts src/cli.tsx && git commit -m "feat: init --agent codex 與 hook 信任提示"`

---

### Task 4: Hook 端讀 `--agent`，Codex 路徑寫狀態檔

**Files:**
- Modify: `src/hook/task-tracker-hook.ts`, `src/hook/apply-event.ts`
- Test: `src/apply-hook-event.test.ts`

**Interfaces:**
- Consumes: `Agent`、`parseAgentArg`（Task 1）
- Produces: `ApplyHookDeps.agent?: Agent`。Codex 時：狀態檔寫 `agent: "codex"`、不寫 `claudeSessionDir`／`workflow`、PostToolUse 不解析 TodoWrite／Task 系列。

- [ ] **Step 1: 寫失敗測試**（附加到 `src/apply-hook-event.test.ts`）

```ts
test("codex：寫入 agent=codex，不寫 claudeSessionDir 與 workflow", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "cx1", cwd: "/work/proj", hook_event_name: "PreToolUse", tool_name: "Bash",
      tool_input: { command: "echo hi" }, transcript_path: "/home/u/.codex/sessions/2026/09/19/rollout-x.jsonl",
    },
    { ...deps, agent: "codex" },
  );
  assert.equal(written[0].agent, "codex");
  assert.equal(written[0].claudeSessionDir, undefined);
  assert.equal(written[0].workflow, undefined);
  assert.equal(written[0].activity?.toolName, "Bash");
  assert.equal(written[0].activity?.phase, "running");
});

test("codex：PostToolUse 不解析 TodoWrite／Task 系列，只更新活動", () => {
  const { written, deps } = capture();
  applyHookEvent(
    {
      session_id: "cx2", cwd: "/work/proj", hook_event_name: "PostToolUse", tool_name: "TodoWrite",
      tool_input: { todos: [{ content: "a", status: "pending" }] },
    },
    { ...deps, agent: "codex" },
  );
  assert.equal(written[0].todos, undefined);
  assert.equal(written[0].activity?.phase, "done");
});

test("claude（沒帶 agent）：狀態檔不出現 agent 欄位，行為不變", () => {
  const { written, deps } = capture();
  applyHookEvent(
    { session_id: "cl1", cwd: "/proj", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } },
    deps,
  );
  assert.equal("agent" in written[0], false);
});
```

- [ ] **Step 2: 確認失敗** — `node --import tsx --test src/apply-hook-event.test.ts`，Expected: FAIL（`agent` 為 undefined）

- [ ] **Step 3: 實作**

`src/hook/apply-event.ts`：`import type { Agent } from "../agent.js";`；`ApplyHookDeps` 加 `agent?: Agent;`。`persist` 內 `deps.writeTaskState({...})` 改為：

```ts
      deps.writeTaskState({
        sessionId: payload.session_id,
        cwd,
        ...(deps.agent === "codex" ? { agent: "codex" as const } : {}),
        claudeSessionDir:
          deps.agent === "codex"
            ? undefined
            : payload.transcript_path
              ? sessionDirFromTranscript(payload.transcript_path)
              : existing?.claudeSessionDir,
        updatedAt,
        todos: todos ?? existing?.todos,
        tasks: tasks ?? existing?.tasks,
        activity,
        workflow: deps.agent === "codex" ? undefined : seedWorkflow(payload, existing?.workflow),
      });
```

在 `if (payload.hook_event_name === "PreToolUse") {...}` 區塊**之後**、`if (toolName === "TodoWrite")` 之前加：

```ts
  if (deps.agent === "codex") {
    // Codex 沒有 TodoWrite／Task 系列工具；只更新活動句。
    persist(undefined, undefined, activity);
    return;
  }
```

`src/hook/task-tracker-hook.ts`：`import { parseAgentArg } from "../agent.js";`；`main()` 內 `const agent = parseAgentArg(process.argv);`，呼叫改為 `applyHookEvent(payloadResult.data, { readTaskState, writeTaskState, appendDebugLog, agent });`。檔頭註解補一句：Codex 以 `--agent codex` 參數呼叫，同一支腳本。

- [ ] **Step 4: 確認通過** — `node --import tsx --test src/apply-hook-event.test.ts src/hook-standalone.test.ts`，Expected: PASS；`pnpm test` 全綠
- [ ] **Step 5: Commit** — `git add src/hook src/apply-hook-event.test.ts && git commit -m "feat: hook 讀 --agent，codex 路徑寫入狀態檔"`

---

### Task 5: `apply_patch` 活動句

**Files:**
- Modify: `src/describe-activity.ts`（`sentenceFor` 的 switch，約 33 行；新增 `patchSentence`）
- Test: `src/describe-activity.test.ts`

**Interfaces:**
- Consumes: 檔內既有 `spaced`、`displayPath`、`rawString`
- Produces: `describeActivity({ toolName: "apply_patch", toolInput: { command: <patch> } })`

- [ ] **Step 1: 寫失敗測試**（附加到 `src/describe-activity.test.ts`；使用檔內 `describe()` helper）

```ts
const PATCH = "*** Begin Patch\n*** Update File: /work/proj/src/a.ts\n@@\n hello\n+world\n*** End Patch";

test("apply_patch 取第一個檔案標頭，路徑相對 cwd", () => {
  assert.equal(describe({ toolName: "apply_patch", toolInput: { command: PATCH }, cwd: "/work/proj" }), "正在修改 src/a.ts");
  assert.equal(describe({ toolName: "apply_patch", toolInput: { command: PATCH }, cwd: "/work/proj", phase: "done" }), "已修改 src/a.ts");
  assert.equal(
    describe({ toolName: "apply_patch", toolInput: { command: PATCH }, cwd: "/work/proj", locale: "en" }),
    "Editing src/a.ts",
  );
});

test("apply_patch 支援 Add／Delete File，多檔取第一個", () => {
  const add = "*** Begin Patch\n*** Add File: /w/new.txt\n+x\n*** Delete File: /w/old.txt\n*** End Patch";
  assert.equal(describe({ toolName: "apply_patch", toolInput: { command: add }, cwd: "/w" }), "正在修改 new.txt");
});

test("apply_patch 抽不到檔名時退回不帶檔名的句子，且不含 patch 內容", () => {
  const text = describe({ toolName: "apply_patch", toolInput: { command: "garbage +secret" } });
  assert.equal(text, "正在修改檔案");
  assert.equal(text.includes("secret"), false);
  assert.equal(describe({ toolName: "apply_patch", toolInput: {}, phase: "done", locale: "en" }), "Edited files");
});

test("Codex 的 Bash 沿用 command 字串", () => {
  assert.equal(describe({ toolName: "Bash", toolInput: { command: "echo hi" } }), "正在執行 echo hi");
});
```

- [ ] **Step 2: 確認失敗** — `node --import tsx --test src/describe-activity.test.ts`，Expected: FAIL（`apply_patch` 走 fallback）

- [ ] **Step 3: 實作** — `sentenceFor` 的 switch 在 `case "Write":` 之後加 `case "apply_patch": return patchSentence(toolInput, cwd, phase, locale);`，並在檔內（`shellFragment` 附近）新增：

```ts
const PATCH_FILE_RE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m;

/** Codex apply_patch：patch 全文在 tool_input.command，只取第一個檔案標頭，不外流 patch 內容。 */
function patchSentence(
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  phase: ActivityPhase,
  locale: Locale,
): string {
  const file = rawString(toolInput, "command")?.match(PATCH_FILE_RE)?.[1]?.trim();
  const named = file ? spaced(phase, locale, "修改", "Editing", "Edited", displayPath(file, cwd)) : undefined;
  if (named) return named;
  if (locale === "en") return phase === "running" ? "Editing files" : "Edited files";
  return phase === "running" ? "正在修改檔案" : "已修改檔案";
}
```

- [ ] **Step 4: 確認通過** — `node --import tsx --test src/describe-activity.test.ts`，Expected: PASS
- [ ] **Step 5: Commit** — `git add src/describe-activity.ts src/describe-activity.test.ts && git commit -m "feat: apply_patch 活動句"`

---

### Task 6: 用真實 Codex fixture 重放，並停用 Claude 專屬檢視

**Files:**
- Create: `src/codex-hook-fixture.test.ts`
- Modify: `src/ui/App.tsx`（advice／tools／cache 三個檢視，約 716–748 行）

**Interfaces:**
- Consumes: `applyHookEvent`（Task 4）、`HookPayloadSchema`、fixture、`agentOf`／`CODEX_UNSUPPORTED_NOTICE`（Task 1）

- [ ] **Step 1: 寫重放測試** `src/codex-hook-fixture.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyHookEvent } from "./hook/apply-event.js";
import { HookPayloadSchema, TaskState } from "./schema.js";

const SAMPLES = readFileSync(new URL("./fixtures/codex-0.155.1-hook-samples.jsonl", import.meta.url), "utf-8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { event: string; payload: unknown });

test("重放 Codex 0.155.1 真實 payload：只處理已註冊事件，最終活動為 apply_patch 完成", () => {
  const previousLocale = process.env.TASK_TRACKER_LOCALE;
  process.env.TASK_TRACKER_LOCALE = "zh";
  try {
    const states = new Map<string, TaskState>();
    const writes: TaskState[] = [];
    const logs: string[] = [];
    const deps = {
      readTaskState: (id: string) => states.get(id) ?? null,
      writeTaskState: (s: TaskState) => { states.set(s.sessionId, s); writes.push(s); },
      appendDebugLog: (m: string) => { logs.push(m); },
      agent: "codex" as const,
    };
    for (const { payload } of SAMPLES) {
      const parsed = HookPayloadSchema.parse(payload);
      applyHookEvent(parsed, deps);
    }
    // UserPromptSubmit、Stop 不是 init 註冊的事件，不會寫狀態檔（沒有 tool_name，只記 debug log）
    const registered = SAMPLES.filter((s) => ["SessionStart", "PreToolUse", "PostToolUse"].includes(s.event));
    assert.equal(writes.length, registered.length);
    const final = writes.at(-1)!;
    assert.equal(final.agent, "codex");
    assert.equal(final.cwd, "/work/proj");
    assert.equal(final.claudeSessionDir, undefined);
    assert.equal(final.activity?.toolName, "apply_patch");
    assert.equal(final.activity?.phase, "done");
    assert.equal(final.activity?.summary, "已修改 a.txt");
    const shell = writes.find((s) => s.activity?.toolName === "Bash" && s.activity.phase === "running");
    assert.match(shell?.activity?.summary ?? "", /^正在執行 /);
  } finally {
    if (previousLocale === undefined) delete process.env.TASK_TRACKER_LOCALE;
    else process.env.TASK_TRACKER_LOCALE = previousLocale;
  }
});
```

- [ ] **Step 2: 確認結果** — `node --import tsx --test src/codex-hook-fixture.test.ts`，Expected: PASS（Task 4、5 已完成）。若失敗，先看是測試假設（例如寫入次數）還是實作問題，不要為了通過而改 fixture。

- [ ] **Step 3: 停用 Claude 專屬檢視** — `src/ui/App.tsx`：`import { agentOf, CODEX_UNSUPPORTED_NOTICE } from "../agent.js";`。
  - advice 檢視的 `uncoveredHint`：在既有 `readTaskState(selectedSessionId)?.claudeSessionDir` 判斷**之前**先判斷 Codex：

    ```ts
    const uncoveredHint =
      selectedSessionId && agentOf(readTaskState(selectedSessionId)) === "codex"
        ? CODEX_UNSUPPORTED_NOTICE
        : selectedSessionId && !readTaskState(selectedSessionId)?.claudeSessionDir
          ? "這個 session 還沒有 transcript 路徑，尚未納入分析"
          : undefined;
    ```
  - tools 檢視的 `uncoveredHint` 同樣改法。
  - cache 檢視：`const lines = agentOf(latest) === "codex" ? [CODEX_UNSUPPORTED_NOTICE] : cachePanelLinesForSession(...)`。

  用量 watcher（約 507 行）以 `state?.claudeSessionDir` 為門檻，Codex 不寫該欄位，所以不會啟動 Claude 專屬讀取，不需要改。

- [ ] **Step 4: 驗證** — `pnpm typecheck && pnpm test`，Expected: 全綠。
- [ ] **Step 5: Commit** — `git add src/codex-hook-fixture.test.ts src/ui/App.tsx && git commit -m "feat: 以真實 Codex payload 重放測試，並停用 Codex 的 Claude 專屬檢視"`

---

# 階段 B：來源分頁

### Task 7: `SessionHint.agent` 與過濾

**Files:**
- Modify: `src/session-preference.ts`、`src/ui/App.tsx`（`hintsFor`，約 113 行）
- Test: `src/session-preference.test.ts`

**Interfaces:**
- Consumes: `Agent`、`TabAgent`、`agentOf`（Task 1）
- Produces: `SessionHint.agent?: Agent`；`filterSessionsByAgent(sessions: SessionHint[], agent: TabAgent): SessionHint[]`；`export function presenceForHint(session: SessionHint, now: number): SessionPresence`（原為檔內私有，僅加 `export`）。

- [ ] **Step 1: 寫失敗測試**（附加到 `src/session-preference.test.ts`，import 補 `filterSessionsByAgent`）

```ts
test("filterSessionsByAgent 依來源過濾，缺省視為 claude，cursor 目前必為空", () => {
  const mixed = [
    { sessionId: "a", cwd: "/p", updatedAt: "2026-09-19T01:00:00.000Z" },
    { sessionId: "b", cwd: "/p", updatedAt: "2026-09-19T01:00:00.000Z", agent: "codex" as const },
    { sessionId: "c", cwd: "/p", updatedAt: "2026-09-19T01:00:00.000Z", agent: "claude" as const },
  ];
  assert.deepEqual(filterSessionsByAgent(mixed, "claude").map((s) => s.sessionId), ["a", "c"]);
  assert.deepEqual(filterSessionsByAgent(mixed, "codex").map((s) => s.sessionId), ["b"]);
  assert.deepEqual(filterSessionsByAgent(mixed, "cursor"), []);
  assert.deepEqual(filterSessionsByAgent([], "claude"), []);
});
```

- [ ] **Step 2: 確認失敗** — `node --import tsx --test src/session-preference.test.ts`，Expected: FAIL

- [ ] **Step 3: 實作** — `src/session-preference.ts`：`import type { Agent, TabAgent } from "./agent.js";`；`SessionHint` 加 `agent?: Agent;`；`presenceForHint` 前加 `export`；新增

```ts
/** 缺省 agent 視為 claude；cursor 尚未接入，任何 session 都不屬於它。 */
export function filterSessionsByAgent(sessions: SessionHint[], agent: TabAgent): SessionHint[] {
  return sessions.filter((session) => (session.agent ?? "claude") === agent);
}
```

`src/ui/App.tsx` 的 `hintsFor` 回傳物件加 `agent: state.agent,`。

- [ ] **Step 4: 確認通過** — `node --import tsx --test src/session-preference.test.ts`，Expected: PASS；`pnpm typecheck`
- [ ] **Step 5: Commit** — `git add src/session-preference.ts src/session-preference.test.ts src/ui/App.tsx && git commit -m "feat: SessionHint 帶來源並可依 agent 過濾"`

---

### Task 8: 分頁純邏輯與元件，並修正 spec

**Files:**
- Create: `src/agent-tabs.ts`, `src/agent-tabs.test.ts`, `src/ui/AgentTabs.tsx`
- Modify: `docs/superpowers/specs/2026-09-19-agent-tabs-design.md`

**Interfaces:**
- Consumes: `TAB_AGENTS`／`TabAgent`／`TAB_LABELS`（Task 1）、`SessionHint`／`presenceForHint`（Task 7）
- Produces: `TabSummary { agent: TabAgent; label: string; count: number; attention: boolean; supported: boolean }`；`nextTabAgent(current, direction?: 1 | -1): TabAgent`；`summarizeTabs(hints: SessionHint[], now?: number): TabSummary[]`；`formatTabLabel(tab: TabSummary): string`；`canSwitchTab(state: { view: string; hasSelectedSession: boolean; pickingSplitPartner: boolean }): boolean`；`<AgentTabs tabs active />`

- [ ] **Step 1: 寫失敗測試** `src/agent-tabs.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { canSwitchTab, formatTabLabel, nextTabAgent, summarizeTabs } from "./agent-tabs.js";

const now = Date.parse("2026-09-19T02:00:00.000Z");
const at = "2026-09-19T01:59:30.000Z";

test("nextTabAgent 循環切換，支援反向", () => {
  assert.equal(nextTabAgent("claude"), "codex");
  assert.equal(nextTabAgent("codex"), "cursor");
  assert.equal(nextTabAgent("cursor"), "claude");
  assert.equal(nextTabAgent("claude", -1), "cursor");
  assert.equal(nextTabAgent("codex", -1), "claude");
});

test("summarizeTabs 依來源計數，等待使用者的 session 標記為 attention，cursor 不支援", () => {
  const tabs = summarizeTabs(
    [
      { sessionId: "a", cwd: "/p", updatedAt: at },
      { sessionId: "b", cwd: "/p", updatedAt: at, agent: "codex", activityToolName: "AskUserQuestion", activityPhase: "running" },
      { sessionId: "c", cwd: "/p", updatedAt: at, agent: "codex" },
    ],
    now,
  );
  assert.deepEqual(tabs.map((t) => [t.agent, t.count, t.attention, t.supported]), [
    ["claude", 1, false, true],
    ["codex", 2, true, true],
    ["cursor", 0, false, false],
  ]);
});

test("formatTabLabel：不支援的顯示 –，待處理加 !", () => {
  assert.equal(formatTabLabel({ agent: "claude", label: "Claude", count: 3, attention: false, supported: true }), "Claude 3");
  assert.equal(formatTabLabel({ agent: "codex", label: "Codex", count: 2, attention: true, supported: true }), "Codex 2 !");
  assert.equal(formatTabLabel({ agent: "cursor", label: "Cursor", count: 0, attention: false, supported: false }), "Cursor –");
});

test("canSwitchTab 只在列表畫面（未選定 session、main、非挑選 split 夥伴）生效", () => {
  assert.equal(canSwitchTab({ view: "main", hasSelectedSession: false, pickingSplitPartner: false }), true);
  assert.equal(canSwitchTab({ view: "main", hasSelectedSession: true, pickingSplitPartner: false }), false);
  assert.equal(canSwitchTab({ view: "main", hasSelectedSession: false, pickingSplitPartner: true }), false);
  assert.equal(canSwitchTab({ view: "split", hasSelectedSession: false, pickingSplitPartner: false }), false);
});
```

- [ ] **Step 2: 確認失敗** — `node --import tsx --test src/agent-tabs.test.ts`，Expected: FAIL

- [ ] **Step 3: 實作**

`src/agent-tabs.ts`：

```ts
import { TAB_AGENTS, TAB_LABELS, type TabAgent } from "./agent.js";
import { filterSessionsByAgent, presenceForHint, type SessionHint } from "./session-preference.js";

export interface TabSummary {
  agent: TabAgent;
  label: string;
  count: number;
  /** 該來源有 session 正在等使用者（提示色）。SessionHint 沒有活動時間，卡住偵測不在分頁上做。 */
  attention: boolean;
  supported: boolean;
}

export function nextTabAgent(current: TabAgent, direction: 1 | -1 = 1): TabAgent {
  const index = TAB_AGENTS.indexOf(current);
  return TAB_AGENTS[(index + direction + TAB_AGENTS.length) % TAB_AGENTS.length];
}

export function summarizeTabs(hints: SessionHint[], now: number = Date.now()): TabSummary[] {
  return TAB_AGENTS.map((agent) => {
    const sessions = filterSessionsByAgent(hints, agent);
    return {
      agent,
      label: TAB_LABELS[agent],
      count: sessions.length,
      attention: sessions.some((session) => presenceForHint(session, now) === "waiting"),
      supported: agent !== "cursor",
    };
  });
}

export function formatTabLabel(tab: TabSummary): string {
  const badge = tab.supported ? String(tab.count) : "–";
  return `${tab.label} ${badge}${tab.attention ? " !" : ""}`;
}

/** 分頁列只在 session 列表畫面顯示，所以也只在那裡響應切換鍵。 */
export function canSwitchTab(state: { view: string; hasSelectedSession: boolean; pickingSplitPartner: boolean }): boolean {
  return state.view === "main" && !state.hasSelectedSession && !state.pickingSplitPartner;
}
```

`src/ui/AgentTabs.tsx`：

```tsx
import { Box, Text } from "ink";
import type { TabAgent } from "../agent.js";
import { formatTabLabel, type TabSummary } from "../agent-tabs.js";

export function AgentTabs({ tabs, active }: { tabs: TabSummary[]; active: TabAgent }) {
  return (
    <Box marginBottom={1}>
      {tabs.map((tab) => {
        const selected = tab.agent === active;
        return (
          <Box key={tab.agent} marginRight={1}>
            <Text
              bold={selected}
              inverse={selected}
              color={tab.attention ? "red" : undefined}
              dimColor={!selected && !tab.supported}
            >
              {` ${formatTabLabel(tab)} `}
            </Text>
          </Box>
        );
      })}
      <Text dimColor> Tab 切換</Text>
    </Box>
  );
}
```

`docs/superpowers/specs/2026-09-19-agent-tabs-design.md` 修正三處：(1)「切換」改為 `Tab`／`Shift+Tab` 循環，刪除 `1`／`2`／`3`，註明 `ink-select-input` 會攔截 `1`–`9`；(2)「提示色」改為只標示「有 session 等待使用者」，卡住不做（`SessionHint` 無活動時間）；(3)「按鍵」段改為只在 session 列表畫面（未選定 session）生效，要從 session 內換分頁先按 `b` 回列表。「風險」的數字鍵一項改為已驗證的事實。

- [ ] **Step 4: 確認通過** — `node --import tsx --test src/agent-tabs.test.ts`，Expected: PASS；`pnpm typecheck`
- [ ] **Step 5: Commit** — `git add src/agent-tabs.ts src/agent-tabs.test.ts src/ui/AgentTabs.tsx docs/superpowers/specs/2026-09-19-agent-tabs-design.md && git commit -m "feat: 分頁純邏輯與 AgentTabs 元件"`

---

### Task 9: App 整合分頁

**Files:**
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: Task 1／7／8 全部；既有 `leaveSessionToList`（`App.tsx:229`）、`hintsFor`、`SessionPicker`、`withNotice`

- [ ] **Step 1: 加狀態與切換函式** — imports 補：

```ts
import { agentOf, type TabAgent } from "../agent.js";
import { canSwitchTab, nextTabAgent, summarizeTabs } from "../agent-tabs.js";
import { AgentTabs } from "./AgentTabs.js";
import { filterSessionsByAgent } from "../session-preference.js";
```

（`agentOf` 已於 Task 6 引入，合併成同一行。）元件內 `pickingSplitPartner` 的 useState 附近加：

```ts
  const [activeAgent, setActiveAgent] = useState<TabAgent>(() =>
    initialSessionId ? agentOf(readTaskState(initialSessionId)) : "claude",
  );
```

`leaveSessionToList` 之後加：

```ts
  // 切換分頁一律回到該分頁的專案清單（清掉選中的 session、專案與 split 狀態）。
  const switchAgentTab = (target: TabAgent) => {
    if (target === activeAgent) return;
    leaveSessionToList();
    setActiveAgent(target);
  };
```

（`initialSessionId` 為 App 既有 prop，若名稱不同以檔內實際名稱為準；`grep -n initialSessionId src/ui/App.tsx` 確認。）

- [ ] **Step 2: 切換鍵** — `useInput` 內 `if (input === "q") {...}` 之後、`if (view === "split")` 之前加：

```ts
      if (
        (key.tab || input === "\t") &&
        canSwitchTab({ view, hasSelectedSession: Boolean(selectedSessionId), pickingSplitPartner })
      ) {
        switchAgentTab(nextTabAgent(activeAgent, key.shift ? -1 : 1));
        return;
      }
```

- [ ] **Step 3: 過濾與自動選取** — 自動選取 effect（`if (browsing || selectedSessionId || sessionIds.length === 0) return;` 那個）內 `const hints = hintsFor(sessionIds);` 改為 `const hints = filterSessionsByAgent(hintsFor(sessionIds), activeAgent);`，並把 `activeAgent` 加進該 effect 的依賴陣列。`n`（跳到需要注意的 session）的處理：`setSelectedSessionId(target.sessionId);` 之後加 `setActiveAgent(agentOf(readTaskState(target.sessionId)));`，避免跨來源時分頁與畫面不一致。

- [ ] **Step 4: 列表畫面加分頁列與過濾** — 在 `if (!selectedSessionId) {` 區塊開頭加：

```ts
    const allHints = hintsFor(sessionIds);
    const withTabs = (child: ReactNode) => (
      <Box flexDirection="column">
        <AgentTabs tabs={summarizeTabs(allHints)} active={activeAgent} />
        {child}
      </Box>
    );
    if (activeAgent === "cursor") {
      return withTabs(
        <Box flexDirection="column">
          <Text dimColor>Cursor 尚未支援。</Text>
          <Text dimColor>接入需先取樣 Cursor 的 hook payload，之後會另開設計。</Text>
        </Box>,
      );
    }
```

該區塊內既有的所有 `return withNotice(..., <X/>)`（無 session、無專案群組、專案 picker、session picker 共四個）都改成 `return withTabs(withNotice(..., <X/>))`；區塊內原本的 `const hints = hintsFor(sessionIds);` 改為 `const hints = filterSessionsByAgent(allHints, activeAgent);`。「還沒有偵測到任何 session 資料」的提示行，Codex 分頁改為：

```ts
const emptyLines =
  activeAgent === "codex"
    ? ["請執行 `task-tracker init --agent codex`，並在 Codex 啟動時的 hooks review 核可 hook。"]
    : (emptyHint ?? ["請確認已執行「task-tracker init」，且 Claude Code 正在執行中。"]);
```

並在兩處原本 `(emptyHint ?? [...]).map(...)` 改為 `emptyLines.map(...)`（把 `emptyLines` 定義放在 `withTabs` 之後）。

- [ ] **Step 5: 驗證** — `pnpm typecheck && pnpm test`，Expected: 全綠。再用 ink 手動驗證（需要在互動終端，請使用者或用 `! ` 執行）：建立暫存狀態目錄放一個 Claude、一個 `agent: "codex"` 的狀態檔（可用 `pnpm dev show` 找目錄與格式），`pnpm dev watch`：
  - 預設 Claude 分頁只列 Claude session；`Tab` 到 Codex 只列 Codex；再 `Tab` 到 Cursor 顯示「尚未支援」；`Shift+Tab` 反向。
  - 進入 session 後按 `Tab` 無反應；按 `b` 回列表後 `Tab` 可切。
  - split（`v`）挑第二個 session 時只列同來源。
  - 目前 Codex 分頁選 Codex session 後按 `a`／`t`／`s`，顯示「Codex session 尚未支援此檢視」。
  - 若 ink 無法在此環境互動，明確回報「UI 未實測」，不要宣稱通過。

- [ ] **Step 6: Commit** — `git add src/ui/App.tsx && git commit -m "feat: watch 依來源分頁，切換回專案清單"`

---

### Task 10: README 與收尾驗證

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — 在「安裝與使用」之後新增「Codex 支援」小節，內容：`task-tracker init --agent codex`（`--project` 寫 `<專案>/.codex/hooks.json`）；需在 Codex hooks review 核可；已用 Codex 0.155.1 測試；目前只支援活動句，任務清單、usage、inspect、workflow 不支援；`~/.codex/config.toml` 需 `[features] hooks = true`。新增「分頁檢視」小節：Claude／Codex／Cursor 三個分頁、`Tab`／`Shift+Tab` 切換、僅在 session 列表畫面、Cursor 尚未支援。更新「專案結構」列出新檔。**不要**改「目前版本」（發版時由 `pnpm version` 同步）。
- [ ] **Step 2: 全量驗證** — `pnpm typecheck && pnpm test && pnpm build`，Expected: 全部成功；貼出通過的測試數。
- [ ] **Step 3: 端到端（可選，需使用者核可 hook）** — 以暫存 HOME 執行 `init --agent codex`，把產生的 hook 命令對 fixture 的一筆 PreToolUse 手動餵 stdin（`echo '<payload>' | node ~/.claude-task-tracker/task-tracker-hook.js --agent codex`），確認狀態檔出現 `"agent": "codex"`。真實 Codex session 的端到端需使用者在互動模式核可 hook 後才能驗證，未核可前不宣稱通過。
- [ ] **Step 4: Commit** — `git add README.md && git commit -m "docs: README 新增 Codex 支援與分頁檢視說明"`
- [ ] **Step 5: 完成條件對照** — 逐條對照兩份 spec 的「完成條件」，未達成或未實測的項目寫進 `docs/superpowers/plans/2026-09-19-codex-support.md` 末尾「完成紀錄」，再交給使用者決定是否 push 到 PR #34。

---

## Self-Review 對照

- **codex spec 範圍內 1–6**：1 → Task 2、3；2 → Task 4；3 → Task 5；4（`update_plan`）已依 Phase 0 移出；5 → Task 1、4、7；6 → Task 10。信任提示 → Task 3。usage／inspect 停用 → Task 6。
- **tabs spec**：分頁列與過濾 → Task 7、8、9；`Tab` 切換 → Task 8、9；切換回專案清單 → Task 9；split 限同來源 → Task 9（picker 已用過濾後 hints，`activeAgent` 不變）；Cursor 只留分頁 → Task 9；README → Task 10。
- **與 spec 的差異（已列入 Task 8 更新 spec）**：數字鍵不能用；分頁提示色只標「等待」；切換鍵只在列表畫面生效。
- 型別一致：`TabAgent`／`Agent`／`TabSummary`／`canSwitchTab` 在各 task 簽章一致；`presenceForHint` 於 Task 7 匯出、Task 8 使用。

## 完成紀錄

（執行後填寫：變更檔案、測試指令與結果、未實測項目。）
