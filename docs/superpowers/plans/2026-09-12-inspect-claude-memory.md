# Inspect Claude Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增唯讀指令 `task-tracker inspect`，用 TUI 顯示指定目錄啟動 Claude Code 時會載入哪些 CLAUDE.md、rules、imports 與 auto memory，以及載入順序。

**Architecture:** 純函式負責解析（路徑、settings 輸入、檔案收集、import 展開、memory 路徑、預覽），Ink 只負責把已經算好的 model 畫出來並在檔案變動時重跑解析。不把這個畫面塞進現有的 `watch`。不新增套件；測試用 Node 內建 `node:test` 加既有的 `tsx`。

**Tech Stack:** TypeScript、Node 18+、現有依賴 commander / ink / react / chokidar / zod。測試：`node --import tsx --test`。

## Global Constraints

- 指令是 `task-tracker inspect [--dir <path>]`。`--dir` 預設 `process.cwd()`。目錄不存在則印錯誤並以 exit code 1 結束，不開 TUI。
- 唯讀。沒有編輯鍵，不寫入任何 Claude 設定或 memory 檔。
- 不顯示 settings 內容。只讀 `user` / `project` / `local` 三層當解析輸入。不讀 managed / policy settings。
- 不涵蓋 skills、MCP、commands、plugins、subagent memory、專案選擇器。
- 不更新 README。
- 介面文案用繁體中文。預覽是磁碟原文，不剝 HTML comment，不加 markdown 套件。
- 不新增套件。排除規則用自寫 glob，只支援 `**`、`*`、`?` 與字面路徑，不支援 brace expansion。
- 空列只保留五格：managed policy、`~/.claude/CLAUDE.md`（或 `CLAUDE_CONFIG_DIR`）、cwd 的 `CLAUDE.md`、cwd 的 `.claude/CLAUDE.md`、cwd 的 `CLAUDE.local.md`。祖先目錄與 rules 目錄沒有檔案就不出現。
- 按需區沒有檔案就整區不顯示。按需項目只顯示路徑與條件，不讀內容、不預覽。
- 掃描 cwd 子目錄時跳過名為 `.git` 與 `node_modules` 的目錄，不跟隨目錄 symlink。
- 只看啟動 TUI 時的 `process.env`。有覆寫才在標題列標出來。不猜別的 session。
- 超過 4 MiB 的 `CLAUDE.md` / `CLAUDE.local.md` 標「Claude 會略過」，不讀進預覽。這條不套用到 rules 或 `MEMORY.md`。
- `MEMORY.md` 的啟動載入邊界是前 200 行或前 25KB（先到為準）。分隔線以下仍可捲動。
- `@import` 最多四層，略過程式碼 span 與 fence，偵測循環。按需檔不讀，所以不展開它們裡面的 import。
- 實作開分支 `feat/inspect-claude-memory`，不要在 `main` 上改。使用者要的是目前工作目錄的分支，不是另外的 git worktree。
- 每個 task 的 commit 用計畫裡的訊息。不要 push。不要改 git config。

---

## File Structure

- Create: `src/inspect/types.ts` — inspect model 的型別。之後每個模組都用這裡的名字。
- Create: `src/inspect/paths.ts` — config dir、managed policy 路徑、git common root、worktree root、slug、路徑包含判斷。
- Create: `src/inspect/settings.ts` — 讀三層 settings，合併 excludes 與 auto memory 開關。失敗時給 warning，不丟例外。
- Create: `src/inspect/glob.ts` — `claudeMdExcludes` 用的最小 glob。
- Create: `src/inspect/markdown.ts` — 抽出 `@import`，以及判斷 rule 是否有 `paths` frontmatter。
- Create: `src/inspect/preview.ts` — 依 entry 狀態決定預覽文字與 MEMORY.md 邊界。
- Create: `src/inspect/walk.ts` — 掃描 cwd 子目錄，跳過 `.git` / `node_modules` / 目錄 symlink。
- Create: `src/inspect/instructions.ts` — 收集啟動與按需的指示檔，不含 import 展開與 memory。
- Create: `src/inspect/expand-imports.ts` — 把可讀的啟動檔 import 插到該檔後面。
- Create: `src/inspect/memory.ts` — 決定 auto memory 目錄與 MEMORY.md / topic 項目。
- Create: `src/inspect/discover.ts` — 把上面組合成 `discoverInspectModel`。
- Create: `src/inspect/watch-targets.ts` — 算出 chokidar 要盯的路徑。
- Create: `src/ui/InspectView.tsx` — 只負責排版，不讀檔。
- Create: `src/ui/InspectApp.tsx` — 鍵盤、重載、把選中項交給 preview。
- Modify: `src/cli.tsx` — 註冊 `inspect`。
- Modify: `package.json` — 加 `test` script。
- Modify: `.github/workflows/ci.yml` — CI 跑測試。
- Test: `src/inspect/*.test.ts` — 跟實作放在一起。tsup 的 entry 是明確檔名，不會把測試打進 bundle。

## 鎖定的介面

後面的 task 只能用這些名字。不要另起同義詞。

```ts
export type InspectSection = "launch" | "onDemand";

export type InspectStatus =
  | "present"
  | "missing"
  | "external"
  | "excluded"
  | "skipped-too-large"
  | "disabled";

export interface InspectEntry {
  id: string;
  section: InspectSection;
  label: string;
  absolutePath: string;
  status: InspectStatus;
  detail?: string;
  trustNote?: string;
  importedBy?: string;
}

export interface InspectModel {
  cwd: string;
  configDir: string;
  headerNotes: string[];
  warnings: string[];
  entries: InspectEntry[];
}

export interface DiscoverOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  managedPolicyPath: string;
}
```

`discoverInspectModel(options: DiscoverOptions): InspectModel` 是唯一對外的解析函式。CLI 傳入 `homedir()`、`process.env`，以及 `defaultManagedPolicyPath()`。測試一律傳暫存目錄，避免碰到使用者家目錄或 `/Library`。

---

### Task 1: 測試腳本、型別、路徑

**Files:**
- Create: `src/inspect/types.ts`
- Create: `src/inspect/paths.ts`
- Create: `src/inspect/paths.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 無。
- Produces: 上面的型別，以及 `resolveConfigDir`、`defaultManagedPolicyPath`、`encodeProjectSlug`、`findGitCommonRoot`、`findWorktreeRoot`、`isInside`。

- [ ] **Step 1: 寫會失敗的測試**

建立 `src/inspect/paths.test.ts`：

```ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  defaultManagedPolicyPath,
  encodeProjectSlug,
  findGitCommonRoot,
  findWorktreeRoot,
  isInside,
  resolveConfigDir,
} from "./paths.js";

test("resolveConfigDir 預設是家目錄下的 .claude，有 CLAUDE_CONFIG_DIR 就用它", () => {
  assert.equal(resolveConfigDir({}, "/Users/me"), "/Users/me/.claude");
  assert.equal(
    resolveConfigDir({ CLAUDE_CONFIG_DIR: "/custom/claude" }, "/Users/me"),
    "/custom/claude",
  );
});

test("defaultManagedPolicyPath 依平台回傳官方路徑", () => {
  assert.equal(
    defaultManagedPolicyPath("darwin"),
    "/Library/Application Support/ClaudeCode/CLAUDE.md",
  );
  assert.equal(defaultManagedPolicyPath("linux"), "/etc/claude-code/CLAUDE.md");
  assert.equal(
    defaultManagedPolicyPath("win32"),
    "C:\\Program Files\\ClaudeCode\\CLAUDE.md",
  );
});

test("encodeProjectSlug 把每個非英數變成連字號", () => {
  assert.equal(
    encodeProjectSlug("/Users/me/my_app"),
    "-Users-me-my-app",
  );
});

test("isInside 只接受 root 自己或它的子路徑", () => {
  assert.equal(isInside("/proj", "/proj"), true);
  assert.equal(isInside("/proj", "/proj/src/a.md"), true);
  assert.equal(isInside("/proj", "/proj-other/a.md"), false);
  assert.equal(isInside("/proj", "/elsewhere/a.md"), false);
});

test("worktree 與主 repo 共用 git common root，worktree root 則是各自的 checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-git-"));
  const main = join(root, "main");
  mkdirSync(main);
  const git = (cwd: string, args: string[]) => {
    const result = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git(main, ["init"]);
  writeFileSync(join(main, "README.md"), "hi\n");
  git(main, ["add", "README.md"]);
  git(main, ["commit", "-m", "init"]);
  const linked = join(root, "linked");
  git(main, ["worktree", "add", linked, "-b", "linked"]);

  assert.equal(findGitCommonRoot(main), main);
  assert.equal(findGitCommonRoot(linked), main);
  assert.equal(findWorktreeRoot(linked), linked);
  assert.equal(findGitCommonRoot(root), null);
  assert.equal(findWorktreeRoot(root), null);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/paths.test.ts`

Expected: FAIL，因為 `./paths.js` 不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/types.ts`：

```ts
export type InspectSection = "launch" | "onDemand";

export type InspectStatus =
  | "present"
  | "missing"
  | "external"
  | "excluded"
  | "skipped-too-large"
  | "disabled";

export interface InspectEntry {
  id: string;
  section: InspectSection;
  label: string;
  absolutePath: string;
  status: InspectStatus;
  detail?: string;
  trustNote?: string;
  importedBy?: string;
}

export interface InspectModel {
  cwd: string;
  configDir: string;
  headerNotes: string[];
  warnings: string[];
  entries: InspectEntry[];
}

export interface DiscoverOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  managedPolicyPath: string;
}
```

`src/inspect/paths.ts`：

```ts
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function resolveConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.CLAUDE_CONFIG_DIR;
  if (override && override.length > 0) return resolve(override);
  return join(home, ".claude");
}

export function defaultManagedPolicyPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}

export function encodeProjectSlug(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, "-");
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  return text.length > 0 ? text : null;
}

function existingDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** 主 checkout。linked worktree 也回傳主 repo，讓 auto memory 共用。不是 git repo 就回 null。 */
export function findGitCommonRoot(cwd: string): string | null {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) return null;
  if (basename(common) === ".git") return existingDir(dirname(common));
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  return toplevel ? existingDir(toplevel) : null;
}

/** 目前這個 checkout。worktree 回傳 worktree 自己，用來找 .claude/settings.json。 */
export function findWorktreeRoot(cwd: string): string | null {
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  return toplevel ? existingDir(toplevel) : null;
}
```

在 `package.json` 的 `scripts` 加上 `"test": "node --import tsx --test src/inspect/*.test.ts"`。

在 `.github/workflows/ci.yml` 的 `pnpm run typecheck` 後面加上一步 `pnpm test`。

- [ ] **Step 4: 跑測試，確認通過**

Run: `pnpm test`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/types.ts src/inspect/paths.ts src/inspect/paths.test.ts package.json .github/workflows/ci.yml docs/superpowers/plans/2026-09-12-inspect-claude-memory.md
git commit -m "$(cat <<'EOF'
Add path helpers for Claude config and memory identity

EOF
)"
```

---

### Task 2: 把 settings 當解析輸入

**Files:**
- Create: `src/inspect/settings.ts`
- Create: `src/inspect/settings.test.ts`

**Interfaces:**
- Consumes: `resolveConfigDir` 的語意（呼叫端先算好 `configDir` 再傳進來）。
- Produces:

```ts
export interface ResolverSettings {
  excludes: string[];
  autoMemoryEnabled: boolean;
  autoMemoryDirectory?: string;
  autoMemoryFromProjectSettings: boolean;
  warnings: string[];
}

export function readResolverSettings(input: {
  cwd: string;
  configDir: string;
  home: string;
  env: NodeJS.ProcessEnv;
  projectRoot: string;
}): ResolverSettings
```

`projectRoot` 是 worktree root；沒有 git repo 時呼叫端傳 `cwd`。

合併規則：

- 檔案：`${configDir}/settings.json`、`${projectRoot}/.claude/settings.json`、`${projectRoot}/.claude/settings.local.json`。
- scalar（`autoMemoryEnabled`、`autoMemoryDirectory`）優先順序是 local > project > user。
- `claudeMdExcludes` 依 user、project、local 串接，去掉重複。
- JSON 壞掉或不是物件：warning `無法解析設定檔，已略過：<path>`，該檔當沒有。
- `autoMemoryDirectory` 必須是絕對路徑或 `~/` 開頭。不合法就 warning `autoMemoryDirectory 路徑無效，已略過：<path>`，並忽略那個值。
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 強制關閉。`0` 或 `false` 強制開啟，蓋過 settings。沒設這個環境變數時，settings 沒寫就預設開啟。
- 最終採用的 `autoMemoryDirectory` 若來自 project 或 local，`autoMemoryFromProjectSettings` 為 true。

- [ ] **Step 1: 寫會失敗的測試**

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readResolverSettings } from "./settings.js";

function fixture(): { home: string; configDir: string; projectRoot: string } {
  const home = mkdtempSync(join(tmpdir(), "inspect-settings-"));
  const configDir = join(home, ".claude");
  const projectRoot = join(home, "proj");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(projectRoot, ".claude"), { recursive: true });
  return { home, configDir, projectRoot };
}

test("local 的 scalar 蓋過 project 與 user，excludes 則串接去重", () => {
  const dirs = fixture();
  writeFileSync(
    join(dirs.configDir, "settings.json"),
    JSON.stringify({
      autoMemoryEnabled: true,
      autoMemoryDirectory: "/from-user",
      claudeMdExcludes: ["**/user.md", "**/shared.md"],
    }),
  );
  writeFileSync(
    join(dirs.projectRoot, ".claude", "settings.json"),
    JSON.stringify({
      autoMemoryEnabled: false,
      autoMemoryDirectory: "/from-project",
      claudeMdExcludes: ["**/project.md", "**/shared.md"],
    }),
  );
  writeFileSync(
    join(dirs.projectRoot, ".claude", "settings.local.json"),
    JSON.stringify({
      autoMemoryDirectory: "~/from-local",
      claudeMdExcludes: ["**/local.md"],
    }),
  );

  const settings = readResolverSettings({ ...dirs, cwd: dirs.projectRoot, env: {} });
  assert.equal(settings.autoMemoryEnabled, false);
  assert.equal(settings.autoMemoryDirectory, join(dirs.home, "from-local"));
  assert.equal(settings.autoMemoryFromProjectSettings, true);
  assert.deepEqual(settings.excludes, ["**/user.md", "**/shared.md", "**/project.md", "**/local.md"]);
  assert.deepEqual(settings.warnings, []);
});

test("壞掉的 JSON 變成 warning，不讓解析失敗", () => {
  const dirs = fixture();
  writeFileSync(join(dirs.configDir, "settings.json"), "{");
  const settings = readResolverSettings({ ...dirs, cwd: dirs.projectRoot, env: {} });
  assert.equal(settings.autoMemoryEnabled, true);
  assert.equal(settings.warnings.length, 1);
  assert.match(settings.warnings[0], /無法解析設定檔，已略過/);
});

test("CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 關閉，0 則強制開啟", () => {
  const dirs = fixture();
  writeFileSync(
    join(dirs.projectRoot, ".claude", "settings.json"),
    JSON.stringify({ autoMemoryEnabled: false }),
  );
  const off = readResolverSettings({
    ...dirs,
    cwd: dirs.projectRoot,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
  });
  const forced = readResolverSettings({
    ...dirs,
    cwd: dirs.projectRoot,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" },
  });
  assert.equal(off.autoMemoryEnabled, false);
  assert.equal(forced.autoMemoryEnabled, true);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/settings.test.ts`

Expected: FAIL，`readResolverSettings` 不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/settings.ts`：

```ts
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface ResolverSettings {
  excludes: string[];
  autoMemoryEnabled: boolean;
  autoMemoryDirectory?: string;
  autoMemoryFromProjectSettings: boolean;
  warnings: string[];
}

interface SettingsFile {
  claudeMdExcludes?: string[];
  autoMemoryEnabled?: boolean;
  autoMemoryDirectory?: string;
}

function readOne(path: string, warnings: string[]): SettingsFile | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    warnings.push(`無法解析設定檔，已略過：${path}`);
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`無法解析設定檔，已略過：${path}`);
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const file: SettingsFile = {};
  if (Array.isArray(obj.claudeMdExcludes) && obj.claudeMdExcludes.every((item) => typeof item === "string")) {
    file.claudeMdExcludes = obj.claudeMdExcludes;
  }
  if (typeof obj.autoMemoryEnabled === "boolean") file.autoMemoryEnabled = obj.autoMemoryEnabled;
  if (typeof obj.autoMemoryDirectory === "string") file.autoMemoryDirectory = obj.autoMemoryDirectory;
  return file;
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

export function readResolverSettings(input: {
  cwd: string;
  configDir: string;
  home: string;
  env: NodeJS.ProcessEnv;
  projectRoot: string;
}): ResolverSettings {
  const warnings: string[] = [];
  const layers: Array<{ source: "user" | "project" | "local"; file?: SettingsFile }> = [
    { source: "user", file: readOne(join(input.configDir, "settings.json"), warnings) },
    { source: "project", file: readOne(join(input.projectRoot, ".claude", "settings.json"), warnings) },
    { source: "local", file: readOne(join(input.projectRoot, ".claude", "settings.local.json"), warnings) },
  ];

  const excludes: string[] = [];
  for (const layer of layers) {
    for (const pattern of layer.file?.claudeMdExcludes ?? []) {
      if (!excludes.includes(pattern)) excludes.push(pattern);
    }
  }

  let autoMemoryEnabled = true;
  let autoMemoryDirectory: string | undefined;
  let autoMemoryFromProjectSettings = false;
  for (const layer of layers) {
    if (layer.file?.autoMemoryEnabled !== undefined) autoMemoryEnabled = layer.file.autoMemoryEnabled;
    if (layer.file?.autoMemoryDirectory !== undefined) {
      const expanded = expandHome(layer.file.autoMemoryDirectory, input.home);
      if (!isAbsolute(expanded)) {
        warnings.push(`autoMemoryDirectory 路徑無效，已略過：${layer.file.autoMemoryDirectory}`);
      } else {
        autoMemoryDirectory = expanded;
        autoMemoryFromProjectSettings = layer.source !== "user";
      }
    }
  }

  const disable = input.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  if (disable === "1") autoMemoryEnabled = false;
  if (disable === "0" || disable === "false") autoMemoryEnabled = true;

  return { excludes, autoMemoryEnabled, autoMemoryDirectory, autoMemoryFromProjectSettings, warnings };
}
```

`cwd` 目前不參與合併，但留在參數裡，避免之後呼叫端簽名再改。實作不要為了消 unused 而拿掉它；在函式開頭寫 `void input.cwd;`。`noUnusedParameters` 是開的。

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --import tsx --test src/inspect/settings.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/settings.ts src/inspect/settings.test.ts
git commit -m "$(cat <<'EOF'
Read Claude settings only as inspect resolver input

EOF
)"
```

---

### Task 3: excludes 用的 glob

**Files:**
- Create: `src/inspect/glob.ts`
- Create: `src/inspect/glob.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces: `export function matchExclude(pattern: string, absolutePath: string): boolean`

`**/monorepo/CLAUDE.md` 要能匹配 `/home/user/monorepo/CLAUDE.md`。`**` 可以匹配零段或多段目錄。單顆 `*` 不跨 `/`。`?` 匹配一個非 `/` 字元。比對整條絕對路徑，不是只比對檔名。

- [ ] **Step 1: 寫會失敗的測試**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { matchExclude } from "./glob.js";

test("matchExclude 支援絕對路徑、雙星與單星", () => {
  assert.equal(
    matchExclude("**/monorepo/CLAUDE.md", "/home/user/monorepo/CLAUDE.md"),
    true,
  );
  assert.equal(
    matchExclude("/home/user/monorepo/other-team/.claude/rules/**", "/home/user/monorepo/other-team/.claude/rules/a.md"),
    true,
  );
  assert.equal(matchExclude("*.md", "/home/user/CLAUDE.md"), false);
  assert.equal(matchExclude("/home/user/*.md", "/home/user/CLAUDE.md"), true);
  assert.equal(matchExclude("/home/user/CLAUDE.md", "/home/user/CLAUDE.md"), true);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/glob.test.ts`

Expected: FAIL，`matchExclude` 不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/glob.ts`：

```ts
function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if ("\\^$+?.()|{}[]".includes(char)) source += `\\${char}`;
    else source += char;
  }
  return new RegExp(`^${source}$`);
}

export function matchExclude(pattern: string, absolutePath: string): boolean {
  return globToRegExp(pattern).test(absolutePath);
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --import tsx --test src/inspect/glob.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/glob.ts src/inspect/glob.test.ts
git commit -m "$(cat <<'EOF'
Match claudeMdExcludes with a small path glob

EOF
)"
```

---

### Task 4: import 與 rule paths

**Files:**
- Create: `src/inspect/markdown.ts`
- Create: `src/inspect/markdown.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces:

```ts
export interface ImportRef {
  raw: string;
  resolvedPath: string;
}

export function extractImports(markdown: string, fromFile: string, home: string): ImportRef[]
export function readRulePaths(markdown: string): string[] | null
```

`extractImports`：

- fence（以 ``` 開頭的行到下一個 fence）與行內 backtick 裡面的 `@` 不當 import。
- `@` 必須在行首或空白後面，所以 `user@example.com` 不算。
- token 讀到空白為止，去掉尾端的 `.,;:)`。
- 相對路徑相對 `fromFile` 所在目錄，不是 cwd。
- `~` 與 `~/` 用 `home` 展開。
- 回傳的 `resolvedPath` 是 `resolve` 後的絕對路徑，不要求檔案存在。

`readRulePaths`：

- 檔案不是以 `---` 開頭的 frontmatter 就回 `null`（啟動時載入）。
- frontmatter 沒有 `paths` 鍵也回 `null`。
- 有 `paths` 就回字串陣列。支援 `paths: "src/**/*.ts"`、`paths: src/**/*.ts`，以及下面接著的 `  - item`。
- 有 `paths` 但解析不出項目時回空陣列，不要回 `null`。空陣列仍表示「有條件、不是無條件啟動載入」。

- [ ] **Step 1: 寫會失敗的測試**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { extractImports, readRulePaths } from "./markdown.js";

test("extractImports 略過 code span 與 fence，並相對來源檔解析", () => {
  const markdown = [
    "See @README and @docs/guide.md.",
    "Mail user@example.com stays literal.",
    "Keep `@README` and `@docs/secret.md` literal.",
    "```",
    "@docs/not-this.md",
    "```",
    "@~/notes.md",
    "",
  ].join("\n");

  const imports = extractImports(markdown, "/proj/CLAUDE.md", "/Users/me");
  assert.deepEqual(
    imports.map((item) => item.resolvedPath),
    ["/proj/README", "/proj/docs/guide.md", "/Users/me/notes.md"],
  );
});

test("readRulePaths 沒有 paths 回 null，有 paths 就回條件", () => {
  assert.equal(readRulePaths("# just a rule\n"), null);
  assert.deepEqual(
    readRulePaths("---\npaths:\n  - src/**/*.ts\n  - \"lib/**/*.ts\"\n---\n# Rule\n"),
    ["src/**/*.ts", "lib/**/*.ts"],
  );
  assert.deepEqual(readRulePaths("---\npaths: src/api/**/*.ts\n---\n"), ["src/api/**/*.ts"]);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/markdown.test.ts`

Expected: FAIL，模組不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/markdown.ts`：

```ts
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface ImportRef {
  raw: string;
  resolvedPath: string;
}

function expandImportPath(raw: string, fromFile: string, home: string): string {
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return resolve(join(home, raw.slice(2)));
  if (isAbsolute(raw)) return resolve(raw);
  return resolve(dirname(fromFile), raw);
}

export function extractImports(markdown: string, fromFile: string, home: string): ImportRef[] {
  const refs: ImportRef[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let index = 0;
    let inSpan = false;
    while (index < line.length) {
      const char = line[index];
      if (char === "`") {
        inSpan = !inSpan;
        index += 1;
        continue;
      }
      const prev = index === 0 ? " " : line[index - 1];
      if (!inSpan && char === "@" && /\s/.test(prev)) {
        let end = index + 1;
        while (end < line.length && !/\s/.test(line[end]) && line[end] !== "`") end += 1;
        let raw = line.slice(index + 1, end);
        raw = raw.replace(/[.,;:)]+$/g, "");
        if (raw.length > 0) {
          refs.push({ raw, resolvedPath: expandImportPath(raw, fromFile, home) });
        }
        index = end;
        continue;
      }
      index += 1;
    }
  }
  return refs;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function readRulePaths(markdown: string): string[] | null {
  if (!markdown.startsWith("---\n") && markdown !== "---") return null;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return null;
  const frontmatter = markdown.slice(4, end).split("\n");
  const pathsIndex = frontmatter.findIndex((line) => line.trim() === "paths:" || line.trim().startsWith("paths:"));
  if (pathsIndex === -1) return null;
  const header = frontmatter[pathsIndex].trim();
  if (header !== "paths:") {
    const inline = unquote(header.slice("paths:".length));
    return inline.length > 0 ? [inline] : [];
  }
  const paths: string[] = [];
  for (const line of frontmatter.slice(pathsIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) break;
    const item = unquote(trimmed.slice(2));
    if (item.length > 0) paths.push(item);
  }
  return paths;
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --import tsx --test src/inspect/markdown.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/markdown.ts src/inspect/markdown.test.ts
git commit -m "$(cat <<'EOF'
Parse Claude imports and path-scoped rule frontmatter

EOF
)"
```

---

### Task 5: 預覽與 MEMORY.md 邊界

**Files:**
- Create: `src/inspect/preview.ts`
- Create: `src/inspect/preview.test.ts`

**Interfaces:**
- Consumes: `InspectEntry`。
- Produces:

```ts
export interface Preview {
  text?: string;
  loadBoundaryLine?: number;
  notice?: string;
}

export function readPreview(entry: InspectEntry): Preview
export function memoryLoadBoundaryLine(text: string): number | undefined
```

規則：

- `missing` / `external` / `excluded` / `skipped-too-large` / `disabled` / `section === "onDemand"`：不讀檔。`notice` 依序是 `未找到`、`外部，可能尚未核准`、`已排除`、`Claude 會略過`、`未載入`、`按需載入，不預覽內容`。
- `present` 且檔案大於 `4 * 1024 * 1024` 且檔名是 `CLAUDE.md` 或 `CLAUDE.local.md`：當略過處理，`notice` 是 `Claude 會略過`，不回傳 `text`。呼叫端在 discover 就要把這種 entry 標成 `skipped-too-large`；preview 再擋一次，避免 UI 讀進大檔。
- 其他 `present`：回傳原文 `text`。讀取失敗時 `notice` 是 `無法讀取`。
- 檔名是 `MEMORY.md` 時，額外用 `memoryLoadBoundaryLine`。只有內容超過邊界才設定 `loadBoundaryLine`。邊界是第 200 行或前 25KB 的 UTF-8 位元組，先到為準。正好 200 行且不到 25KB 時不設邊界。

- [ ] **Step 1: 寫會失敗的測試**

```ts
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InspectEntry } from "./types.js";
import { memoryLoadBoundaryLine, readPreview } from "./preview.js";

function entry(overrides: Partial<InspectEntry> & Pick<InspectEntry, "absolutePath">): InspectEntry {
  return {
    id: "id",
    section: "launch",
    label: "label",
    status: "present",
    ...overrides,
  };
}

test("memoryLoadBoundaryLine 取 200 行與 25KB 的較早者", () => {
  assert.equal(memoryLoadBoundaryLine("one\ntwo\n"), undefined);
  const lines = Array.from({ length: 201 }, (_, index) => `line ${index}`).join("\n");
  assert.equal(memoryLoadBoundaryLine(lines), 200);
  const wide = `${"x".repeat(25 * 1024 + 10)}\n`;
  assert.equal(memoryLoadBoundaryLine(wide), 0);
});

test("readPreview 對未載入狀態只給提示，present 則回原文", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-preview-"));
  const file = join(dir, "CLAUDE.md");
  writeFileSync(file, "hello\n");
  assert.equal(readPreview(entry({ absolutePath: file })).text, "hello\n");
  assert.equal(readPreview(entry({ absolutePath: file, status: "missing" })).notice, "未找到");
  assert.equal(
    readPreview(entry({ absolutePath: file, section: "onDemand" })).notice,
    "按需載入，不預覽內容",
  );
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/preview.test.ts`

Expected: FAIL，模組不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/preview.ts`：

```ts
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { InspectEntry, InspectStatus } from "./types.js";

const FOUR_MIB = 4 * 1024 * 1024;
const MEMORY_BYTES = 25 * 1024;
const MEMORY_LINES = 200;

export interface Preview {
  text?: string;
  loadBoundaryLine?: number;
  notice?: string;
}

const NOTICE: Partial<Record<InspectStatus, string>> = {
  missing: "未找到",
  external: "外部，可能尚未核准",
  excluded: "已排除",
  "skipped-too-large": "Claude 會略過",
  disabled: "未載入",
};

export function memoryLoadBoundaryLine(text: string): number | undefined {
  const lines = text.split("\n");
  let bytes = 0;
  const limit = Math.min(lines.length, MEMORY_LINES);
  for (let index = 0; index < limit; index += 1) {
    const lineBytes = Buffer.byteLength(lines[index], "utf8");
    const separator = index < lines.length - 1 ? 1 : 0;
    if (bytes + lineBytes + separator > MEMORY_BYTES) return index;
    bytes += lineBytes + separator;
  }
  return lines.length > MEMORY_LINES ? MEMORY_LINES : undefined;
}

function isClaudeMd(path: string): boolean {
  const name = basename(path);
  return name === "CLAUDE.md" || name === "CLAUDE.local.md";
}

export function readPreview(entry: InspectEntry): Preview {
  if (entry.section === "onDemand") return { notice: "按需載入，不預覽內容" };
  const notice = NOTICE[entry.status];
  if (notice) return { notice };
  try {
    if (isClaudeMd(entry.absolutePath) && statSync(entry.absolutePath).size > FOUR_MIB) {
      return { notice: "Claude 會略過" };
    }
    const text = readFileSync(entry.absolutePath, "utf8");
    if (basename(entry.absolutePath) !== "MEMORY.md") return { text };
    const loadBoundaryLine = memoryLoadBoundaryLine(text);
    return loadBoundaryLine === undefined ? { text } : { text, loadBoundaryLine };
  } catch {
    return { notice: "無法讀取" };
  }
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --import tsx --test src/inspect/preview.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/preview.ts src/inspect/preview.test.ts
git commit -m "$(cat <<'EOF'
Preview loaded Claude files and mark the memory boundary

EOF
)"
```

---

### Task 6: 收集啟動與按需指示檔

**Files:**
- Create: `src/inspect/walk.ts`
- Create: `src/inspect/instructions.ts`
- Create: `src/inspect/instructions.test.ts`

**Interfaces:**
- Consumes: `InspectEntry`、`readRulePaths`、`isInside`、`matchExclude`。
- Produces:

```ts
export function walkProjectFiles(root: string): string[]

export function collectInstructionEntries(input: {
  cwd: string;
  configDir: string;
  managedPolicyPath: string;
  excludes: string[];
}): InspectEntry[]
```

`walkProjectFiles` 回傳 `root` 底下所有檔案的絕對路徑，排序。跳過名為 `.git` 與 `node_modules` 的目錄。目錄如果是 symlink，整棵不進入。檔案 symlink 要列入，呼叫端再決定能不能讀。

`collectInstructionEntries` 的啟動順序：

1. managed policy。永遠有一筆。不套用 excludes。缺檔 `status: "missing"`，有檔 `present`。label `組織政策`。
2. `${configDir}/CLAUDE.md`。永遠有一筆。label `使用者 CLAUDE.md`。
3. `${configDir}/rules` 底下的 `.md`。沒有 `paths` 才放啟動區，label `使用者規則`。有 `paths` 放按需區，`detail` 是路徑以 `, ` 連接。
4. 從 cwd 的父目錄走到檔案系統根。每個存在的 `CLAUDE.md`、`CLAUDE.local.md`，以及該層 `.claude/rules` 裡沒有 `paths` 的 `.md`。同一層先 `CLAUDE.md`，再 `CLAUDE.local.md`，再規則（路徑排序）。label 分別是 `上層 CLAUDE.md`、`上層 CLAUDE.local.md`、`上層規則`。有 `paths` 的上層規則進按需區。
5. cwd 三格永遠有：`CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md`。label 用這三個檔名。
6. cwd 的 `.claude/rules` 裡沒有 `paths` 的 `.md`，label `規則`。有 `paths` 的進按需區。

按需區在啟動區之後：

- cwd 子目錄的 `CLAUDE.md` / `CLAUDE.local.md`（不含 cwd 自己那三格）。label `子目錄 CLAUDE.md` 或 `子目錄 CLAUDE.local.md`。
- cwd 底下、但不在 cwd `.claude/rules` 的 nested rules。label `子目錄規則`。不論有沒有 `paths` 都是按需。有 `paths` 時把條件放進 `detail`。
- 上面第 3、4、6 點被判成有 `paths` 的規則。

其他規則：

- `id` 用 `${section}:${absolutePath}`。
- 檔案是 symlink，且 `realpath` 不在 `cwd` 也不在 `configDir`：`status: "external"`，`detail` 保留 `外部，可能尚未核准`，不讀內容、不看 frontmatter。這種項目若原本會在啟動區，改放啟動區但不可讀；若是子目錄掃描到的，仍放按需區。
- 路徑符合任一 exclude，且不是 managed policy：`status: "excluded"`。五格空列若被排除，仍留下，不要刪掉。
- `CLAUDE.md` / `CLAUDE.local.md` 大於 4 MiB：`status: "skipped-too-large"`。
- 缺檔的五格不要套 4 MiB 檢查。

- [ ] **Step 1: 寫會失敗的測試**

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectInstructionEntries } from "./instructions.js";

test("collectInstructionEntries 留五格空列，祖先與按需規則只在有檔時出現", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-files-"));
  const cwd = join(root, "repo", "pkg");
  mkdirSync(join(cwd, "nested"), { recursive: true });
  mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
  mkdirSync(join(root, "repo", ".claude", "rules"), { recursive: true });
  const configDir = join(root, "config");
  mkdirSync(join(configDir, "rules"), { recursive: true });

  writeFileSync(join(configDir, "CLAUDE.md"), "user\n");
  writeFileSync(join(configDir, "rules", "always.md"), "always\n");
  writeFileSync(join(configDir, "rules", "api.md"), "---\npaths:\n  - src/**/*.ts\n---\napi\n");
  writeFileSync(join(root, "repo", "CLAUDE.md"), "parent\n");
  writeFileSync(join(cwd, ".claude", "rules", "local.md"), "local\n");
  writeFileSync(join(cwd, "nested", "CLAUDE.md"), "nested\n");
  writeFileSync(join(cwd, "nested", ".claude", "rules", "later.md"), "later\n");

  const entries = collectInstructionEntries({
    cwd,
    configDir,
    managedPolicyPath: join(root, "missing-policy.md"),
    excludes: [],
  });

  assert.equal(entries[0]?.label, "組織政策");
  assert.equal(entries[1]?.label, "使用者 CLAUDE.md");
  assert.equal(entries.find((entry) => entry.absolutePath === join(root, "repo", "CLAUDE.md"))?.label, "上層 CLAUDE.md");
  for (const label of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
    assert.equal(entries.some((entry) => entry.label === label), true);
  }
  assert.equal(entries.find((entry) => entry.label === "組織政策")?.status, "missing");
  assert.equal(entries.find((entry) => entry.label === "CLAUDE.md")?.status, "missing");
  assert.equal(entries.some((entry) => entry.absolutePath.endsWith("CLAUDE.local.md") && entry.status === "missing"), true);
  assert.equal(entries.some((entry) => entry.label === "規則" && entry.section === "launch"), true);
  assert.equal(entries.some((entry) => entry.label === "使用者規則" && entry.section === "onDemand" && entry.detail === "src/**/*.ts"), true);
  assert.equal(entries.some((entry) => entry.label === "子目錄 CLAUDE.md"), true);
  assert.equal(entries.some((entry) => entry.label === "子目錄規則"), true);
});

test("指到專案與 config 之外的 rule symlink 標成外部且不讀", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-link-"));
  const cwd = join(root, "proj");
  const configDir = join(root, "config");
  const outside = join(root, "outside.md");
  mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
  mkdirSync(configDir);
  writeFileSync(outside, "---\npaths:\n  - secret\n---\nsecret\n");
  symlinkSync(outside, join(cwd, ".claude", "rules", "linked.md"));

  const entries = collectInstructionEntries({
    cwd,
    configDir,
    managedPolicyPath: join(root, "policy.md"),
    excludes: [],
  });
  const linked = entries.find((entry) => entry.absolutePath.endsWith("linked.md"));
  assert.equal(linked?.status, "external");
  assert.equal(linked?.detail, "外部，可能尚未核准");
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/instructions.test.ts`

Expected: FAIL，模組不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/walk.ts`。目錄 symlink 的 `isDirectory()` 是 false，所以用 `statSync` 判斷目標是目錄就跳過，不要跟隨：

```ts
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);

export function walkProjectFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let targetIsDir = false;
        try {
          targetIsDir = statSync(path).isDirectory();
        } catch {
          targetIsDir = false;
        }
        if (targetIsDir) continue;
        files.push(path);
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path);
        continue;
      }
      if (entry.isFile()) files.push(path);
    }
  }
  return files.sort();
}
```

`src/inspect/instructions.ts`：

```ts
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { walkProjectFiles } from "./walk.js";
import { matchExclude } from "./glob.js";
import { readRulePaths } from "./markdown.js";
import { isInside } from "./paths.js";
import { InspectEntry, InspectStatus } from "./types.js";

const FOUR_MIB = 4 * 1024 * 1024;

function entry(input: {
  section: InspectEntry["section"];
  label: string;
  absolutePath: string;
  status: InspectStatus;
  detail?: string;
}): InspectEntry {
  return {
    id: `${input.section}:${input.absolutePath}`,
    section: input.section,
    label: input.label,
    absolutePath: input.absolutePath,
    status: input.status,
    detail: input.detail,
  };
}

function ancestors(cwd: string): string[] {
  const found: string[] = [];
  let dir = dirname(resolve(cwd));
  while (true) {
    found.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found.reverse();
}

function ruleFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name))
    .sort();
}

function externalTarget(path: string, cwd: string, configDir: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    const target = realpathSync(path);
    return !isInside(cwd, target) && !isInside(configDir, target);
  } catch {
    return false;
  }
}

function claudeStatus(path: string, exists: boolean): InspectStatus {
  if (!exists) return "missing";
  const name = basename(path);
  if ((name === "CLAUDE.md" || name === "CLAUDE.local.md") && statSync(path).size > FOUR_MIB) {
    return "skipped-too-large";
  }
  return "present";
}

function applyExclude(item: InspectEntry, excludes: string[], protectedPath?: string): InspectEntry {
  if (protectedPath && item.absolutePath === protectedPath) return item;
  if (excludes.some((pattern) => matchExclude(pattern, item.absolutePath))) {
    return { ...item, status: "excluded" };
  }
  return item;
}

function classifyRule(
  path: string,
  label: string,
  cwd: string,
  configDir: string,
  forceOnDemand: boolean,
): InspectEntry {
  if (externalTarget(path, cwd, configDir)) {
    return entry({
      section: forceOnDemand ? "onDemand" : "launch",
      label,
      absolutePath: path,
      status: "external",
      detail: "外部，可能尚未核准",
    });
  }
  let paths: string[] | null = null;
  try {
    paths = readRulePaths(readFileSync(path, "utf8"));
  } catch {
    paths = null;
  }
  const onDemand = forceOnDemand || paths !== null;
  return entry({
    section: onDemand ? "onDemand" : "launch",
    label,
    absolutePath: path,
    status: "present",
    detail: paths && paths.length > 0 ? paths.join(", ") : undefined,
  });
}

export function collectInstructionEntries(input: {
  cwd: string;
  configDir: string;
  managedPolicyPath: string;
  excludes: string[];
}): InspectEntry[] {
  const cwd = resolve(input.cwd);
  const launch: InspectEntry[] = [];
  const onDemand: InspectEntry[] = [];
  const push = (item: InspectEntry) => {
    (item.section === "launch" ? launch : onDemand).push(item);
  };

  push(
    applyExclude(
      entry({
        section: "launch",
        label: "組織政策",
        absolutePath: input.managedPolicyPath,
        status: existsSync(input.managedPolicyPath) ? "present" : "missing",
      }),
      input.excludes,
      input.managedPolicyPath,
    ),
  );

  const userClaude = join(input.configDir, "CLAUDE.md");
  push(
    applyExclude(
      entry({
        section: "launch",
        label: "使用者 CLAUDE.md",
        absolutePath: userClaude,
        status: claudeStatus(userClaude, existsSync(userClaude)),
      }),
      input.excludes,
    ),
  );

  for (const path of ruleFiles(join(input.configDir, "rules"))) {
    push(applyExclude(classifyRule(path, "使用者規則", cwd, input.configDir, false), input.excludes));
  }

  for (const dir of ancestors(cwd)) {
    for (const [name, label] of [
      ["CLAUDE.md", "上層 CLAUDE.md"],
      ["CLAUDE.local.md", "上層 CLAUDE.local.md"],
    ] as const) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      push(applyExclude(entry({
        section: "launch",
        label,
        absolutePath: path,
        status: claudeStatus(path, true),
      }), input.excludes));
    }
    for (const path of ruleFiles(join(dir, ".claude", "rules"))) {
      push(applyExclude(classifyRule(path, "上層規則", cwd, input.configDir, false), input.excludes));
    }
  }

  for (const [relativePath, label] of [
    ["CLAUDE.md", "CLAUDE.md"],
    [join(".claude", "CLAUDE.md"), ".claude/CLAUDE.md"],
    ["CLAUDE.local.md", "CLAUDE.local.md"],
  ] as const) {
    const path = join(cwd, relativePath);
    push(
      applyExclude(
        entry({
          section: "launch",
          label,
          absolutePath: path,
          status: claudeStatus(path, existsSync(path)),
        }),
        input.excludes,
      ),
    );
  }

  for (const path of ruleFiles(join(cwd, ".claude", "rules"))) {
    push(applyExclude(classifyRule(path, "規則", cwd, input.configDir, false), input.excludes));
  }

  const seen = new Set([...launch, ...onDemand].map((item) => item.absolutePath));
  for (const path of walkProjectFiles(cwd)) {
    if (seen.has(path)) continue;
    const name = basename(path);
    if (name === "CLAUDE.md" || name === "CLAUDE.local.md") {
      push(applyExclude(entry({
        section: "onDemand",
        label: name === "CLAUDE.md" ? "子目錄 CLAUDE.md" : "子目錄 CLAUDE.local.md",
        absolutePath: path,
        status: "present",
      }), input.excludes));
      continue;
    }
    if (name.endsWith(".md") && path.includes(`${sep}.claude${sep}rules${sep}`)) {
      push(applyExclude(classifyRule(path, "子目錄規則", cwd, input.configDir, true), input.excludes));
    }
  }

  return [...launch, ...onDemand];
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --import tsx --test src/inspect/instructions.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/walk.ts src/inspect/instructions.ts src/inspect/instructions.test.ts
git commit -m "$(cat <<'EOF'
Collect Claude instruction files in load order

EOF
)"
```

---

### Task 7: 展開 import，並組出不含 memory 的 model

**Files:**
- Create: `src/inspect/expand-imports.ts`
- Create: `src/inspect/discover.ts`
- Create: `src/inspect/discover.test.ts`

**Interfaces:**
- Consumes: `collectInstructionEntries`、`extractImports`、`readResolverSettings`、`resolveConfigDir`、`findWorktreeRoot`、`InspectEntry`、`DiscoverOptions`、`InspectModel`。
- Produces:

```ts
export function expandImports(entries: InspectEntry[], input: {
  cwd: string;
  configDir: string;
  home: string;
}): InspectEntry[]

export function discoverInspectModel(options: DiscoverOptions): InspectModel
```

`expandImports`：

- 只處理 `section === "launch"` 且 `status === "present"` 的項目。
- 讀檔失敗就跳過該檔的 import，不丟例外。
- 相對 `isInside(cwd)` 或 `isInside(configDir)` 的目標：若檔案存在且不是超過 4 MiB 的 CLAUDE.md，插入一筆 `present`，label `匯入`，`importedBy` 是來源檔的 `absolutePath`，`detail` 是 `由 <來源檔名> 匯入`。不存在則 `missing`，仍插入。
- 外面的目標：`status: "external"`，`detail: "外部，可能尚未核准"`，不讀內容、不繼續展開。
- 深度從被匯入的第一層算 1，超過 4 不插入。
- 以 `realpath`（失敗就用絕對路徑）偵測循環。已經在目前鏈上的路徑不插入。
- 新項目的 `id` 是 `launch:import:${resolvedPath}:${importedBy}`。
- 插入位置是該來源項目的緊後面，深度優先，所以先展開子 import，再處理下一個原本的項目。

`discoverInspectModel` 目前：

- `configDir = resolveConfigDir(env, home)`。
- `projectRoot = findWorktreeRoot(cwd) ?? resolve(cwd)`。
- settings 用 Task 2 的函式。warnings 放進 model。
- headerNotes：`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY`、`CLAUDE_CODE_PROJECT_DIR_NAME` 有設才各加一行 `NAME=value`。`CLAUDE_CODE_PROJECT_DIR_NAME` 只有在 `CLAUDE_CONFIG_DIR` 也有設時才列入，因為只有那時它才會改 memory 路徑。
- entries 是 `expandImports(collectInstructionEntries(...))`。這個 task 還不要加 auto memory。

- [ ] **Step 1: 寫會失敗的測試**

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverInspectModel } from "./discover.js";

test("discoverInspectModel 展開專案內 import，專案外只列路徑", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-import-"));
  const cwd = join(root, "proj");
  const configDir = join(root, "config");
  mkdirSync(cwd);
  mkdirSync(configDir);
  writeFileSync(join(cwd, "CLAUDE.md"), "See @docs/guide.md and @/outside/secret.md\n");
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "guide.md"), "guide\n");

  const model = discoverInspectModel({
    cwd,
    env: { CLAUDE_CONFIG_DIR: configDir },
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });

  const imported = model.entries.find((entry) => entry.importedBy?.endsWith("CLAUDE.md") && entry.absolutePath.endsWith("guide.md"));
  const external = model.entries.find((entry) => entry.status === "external" && entry.absolutePath === "/outside/secret.md");
  assert.equal(imported?.label, "匯入");
  assert.equal(imported?.status, "present");
  assert.equal(external?.detail, "外部，可能尚未核准");
  assert.equal(model.headerNotes.some((note) => note.startsWith("CLAUDE_CONFIG_DIR=")), true);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/discover.test.ts`

Expected: FAIL，`discoverInspectModel` 不存在。

- [ ] **Step 3: 寫實作**

`src/inspect/expand-imports.ts`：

```ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { extractImports } from "./markdown.js";
import { isInside } from "./paths.js";
import { InspectEntry } from "./types.js";

const FOUR_MIB = 4 * 1024 * 1024;
const MAX_DEPTH = 4;

function identity(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function skippedClaudeMd(path: string): boolean {
  const name = basename(path);
  if (name !== "CLAUDE.md" && name !== "CLAUDE.local.md") return false;
  try {
    return statSync(path).size > FOUR_MIB;
  } catch {
    return false;
  }
}

export function expandImports(entries: InspectEntry[], input: {
  cwd: string;
  configDir: string;
  home: string;
}): InspectEntry[] {
  const output: InspectEntry[] = [];
  const expandAfter = (source: InspectEntry, depth: number, chain: Set<string>) => {
    if (source.section !== "launch" || source.status !== "present" || depth >= MAX_DEPTH) return;
    let markdown = "";
    try {
      markdown = readFileSync(source.absolutePath, "utf8");
    } catch {
      return;
    }
    for (const ref of extractImports(markdown, source.absolutePath, input.home)) {
      const allowed = isInside(input.cwd, ref.resolvedPath) || isInside(input.configDir, ref.resolvedPath);
      const key = identity(ref.resolvedPath);
      if (chain.has(key)) continue;
      const nextChain = new Set(chain);
      nextChain.add(key);
      const imported: InspectEntry = {
        id: `launch:import:${ref.resolvedPath}:${source.absolutePath}`,
        section: "launch",
        label: "匯入",
        absolutePath: ref.resolvedPath,
        status: "missing",
        detail: allowed ? `由 ${basename(source.absolutePath)} 匯入` : "外部，可能尚未核准",
        importedBy: source.absolutePath,
      };
      if (!allowed) {
        imported.status = "external";
        output.push(imported);
        continue;
      }
      if (existsSync(ref.resolvedPath) && !skippedClaudeMd(ref.resolvedPath)) {
        imported.status = "present";
      } else if (skippedClaudeMd(ref.resolvedPath)) {
        imported.status = "skipped-too-large";
      }
      output.push(imported);
      if (imported.status === "present") expandAfter(imported, depth + 1, nextChain);
    }
  };

  for (const item of entries) {
    output.push(item);
    const chain = new Set([identity(item.absolutePath)]);
    expandAfter(item, 0, chain);
  }
  return output;
}
```

深度：`expandAfter` 在 `depth >= 4` 時停止。來源檔呼叫時 depth 是 0，第一層 import 插完後以 depth 1 展開子 import，第四層插完後不再展開。這符合「最多四層」。

`src/inspect/discover.ts`：

```ts
import { resolve } from "node:path";
import { expandImports } from "./expand-imports.js";
import { collectInstructionEntries } from "./instructions.js";
import { findWorktreeRoot, resolveConfigDir } from "./paths.js";
import { readResolverSettings } from "./settings.js";
import { DiscoverOptions, InspectModel } from "./types.js";

function headerNotes(env: NodeJS.ProcessEnv): string[] {
  const notes: string[] = [];
  if (env.CLAUDE_CONFIG_DIR) notes.push(`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`);
  if (env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) {
    notes.push(`CLAUDE_CODE_DISABLE_AUTO_MEMORY=${env.CLAUDE_CODE_DISABLE_AUTO_MEMORY}`);
  }
  if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CODE_PROJECT_DIR_NAME) {
    notes.push(`CLAUDE_CODE_PROJECT_DIR_NAME=${env.CLAUDE_CODE_PROJECT_DIR_NAME}`);
  }
  return notes;
}

export function discoverInspectModel(options: DiscoverOptions): InspectModel {
  const cwd = resolve(options.cwd);
  const configDir = resolveConfigDir(options.env, options.home);
  const projectRoot = findWorktreeRoot(cwd) ?? cwd;
  const settings = readResolverSettings({
    cwd,
    configDir,
    home: options.home,
    env: options.env,
    projectRoot,
  });
  const entries = expandImports(
    collectInstructionEntries({
      cwd,
      configDir,
      managedPolicyPath: options.managedPolicyPath,
      excludes: settings.excludes,
    }),
    { cwd, configDir, home: options.home },
  );
  return {
    cwd,
    configDir,
    headerNotes: headerNotes(options.env),
    warnings: settings.warnings,
    entries,
  };
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --import tsx --test src/inspect/discover.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/expand-imports.ts src/inspect/discover.ts src/inspect/discover.test.ts
git commit -m "$(cat <<'EOF'
Expand in-project Claude imports in load order

EOF
)"
```

---

### Task 8: 加入 auto memory

**Files:**
- Create: `src/inspect/memory.ts`
- Modify: `src/inspect/discover.ts`
- Modify: `src/inspect/discover.test.ts`

**Interfaces:**
- Consumes: `ResolverSettings`、`encodeProjectSlug`、`findGitCommonRoot`、`InspectEntry`。
- Produces:

```ts
export function collectMemoryEntries(input: {
  cwd: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  settings: ResolverSettings;
}): InspectEntry[]
```

路徑：

1. `settings.autoMemoryDirectory` 有值就用它。
2. 否則若 `CLAUDE_CONFIG_DIR` 與 `CLAUDE_CODE_PROJECT_DIR_NAME` 都有設，目錄是 `${configDir}/projects/${CLAUDE_CODE_PROJECT_DIR_NAME}/memory`。名稱原樣使用，不再做 slug。
3. 否則用 `findGitCommonRoot(cwd) ?? resolve(cwd)`，目錄是 `${configDir}/projects/${encodeProjectSlug(root)}/memory`。

關閉時（`settings.autoMemoryEnabled === false`）：只回一筆啟動項目，`status: "disabled"`，label `auto memory`，`absolutePath` 是上面的 memory 目錄，`detail` 是 `未載入`。不要列 topic 檔。

開啟時：

- 啟動區一筆 `MEMORY.md`，路徑是 `${memoryDir}/MEMORY.md`。有檔 `present`，沒檔 `missing`。label `MEMORY.md`。
- 若 `settings.autoMemoryFromProjectSettings`，這筆加 `trustNote: "來自專案設定，需已信任此資料夾"`。
- `memoryDir` 裡除了 `MEMORY.md` 以外的 `.md`，路徑排序，放按需區，label `memory 筆記`，`status: "present"`。目錄不存在就不要 topic 項目。

`discoverInspectModel` 把這些項目接到 instruction entries 後面。disabled 那一筆也接在後面。

- [ ] **Step 1: 在既有 discover 測試檔加上會失敗的測試**

```ts
test("auto memory 用 git common root 的 slug，專案設定的目錄要標信任", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-memory-"));
  const cwd = join(root, "My App");
  const configDir = join(root, "config");
  mkdirSync(cwd);
  mkdirSync(join(configDir, "projects", "-tmp-replaced", "memory"), { recursive: true });
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  const custom = join(root, "custom-memory");
  mkdirSync(custom);
  writeFileSync(join(custom, "MEMORY.md"), "index\n");
  writeFileSync(join(custom, "topic.md"), "topic\n");
  writeFileSync(
    join(cwd, ".claude", "settings.json"),
    JSON.stringify({ autoMemoryDirectory: custom }),
  );

  const model = discoverInspectModel({
    cwd,
    env: {},
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });

  const index = model.entries.find((entry) => entry.label === "MEMORY.md");
  assert.equal(index?.absolutePath, join(custom, "MEMORY.md"));
  assert.equal(index?.trustNote, "來自專案設定，需已信任此資料夾");
  assert.equal(model.entries.some((entry) => entry.label === "memory 筆記" && entry.section === "onDemand"), true);
});

test("auto memory 被關掉時不列筆記內容", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-memory-off-"));
  const cwd = join(root, "proj");
  mkdirSync(cwd);
  const model = discoverInspectModel({
    cwd,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    home: root,
    managedPolicyPath: join(root, "policy.md"),
  });
  const memory = model.entries.find((entry) => entry.label === "auto memory");
  assert.equal(memory?.status, "disabled");
  assert.equal(model.entries.some((entry) => entry.label === "memory 筆記"), false);
});
```

第一個測試不要依賴 git。沒有 git 時 slug 會用 cwd。這個案例走 `autoMemoryDirectory`，所以 slug 不會出現。第二個測試確認關閉。

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/discover.test.ts`

Expected: FAIL，找不到 `MEMORY.md` 項目。

- [ ] **Step 3: 寫實作並接到 discover**

`src/inspect/memory.ts`：

```ts
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeProjectSlug, findGitCommonRoot } from "./paths.js";
import { ResolverSettings } from "./settings.js";
import { InspectEntry } from "./types.js";

export function resolveMemoryDir(input: {
  cwd: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  settings: ResolverSettings;
}): string {
  if (input.settings.autoMemoryDirectory) return input.settings.autoMemoryDirectory;
  if (input.env.CLAUDE_CONFIG_DIR && input.env.CLAUDE_CODE_PROJECT_DIR_NAME) {
    return join(input.configDir, "projects", input.env.CLAUDE_CODE_PROJECT_DIR_NAME, "memory");
  }
  const root = findGitCommonRoot(input.cwd) ?? resolve(input.cwd);
  return join(input.configDir, "projects", encodeProjectSlug(root), "memory");
}

export function collectMemoryEntries(input: {
  cwd: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  settings: ResolverSettings;
}): InspectEntry[] {
  const memoryDir = resolveMemoryDir(input);
  if (!input.settings.autoMemoryEnabled) {
    return [{
      id: `launch:memory-disabled:${memoryDir}`,
      section: "launch",
      label: "auto memory",
      absolutePath: memoryDir,
      status: "disabled",
      detail: "未載入",
    }];
  }
  const indexPath = join(memoryDir, "MEMORY.md");
  const index: InspectEntry = {
    id: `launch:${indexPath}`,
    section: "launch",
    label: "MEMORY.md",
    absolutePath: indexPath,
    status: existsSync(indexPath) ? "present" : "missing",
    trustNote: input.settings.autoMemoryFromProjectSettings ? "來自專案設定，需已信任此資料夾" : undefined,
  };
  const topics: InspectEntry[] = [];
  if (existsSync(memoryDir)) {
    for (const name of readdirSync(memoryDir).filter((item) => item.endsWith(".md") && item !== "MEMORY.md").sort()) {
      const path = join(memoryDir, name);
      topics.push({
        id: `onDemand:${path}`,
        section: "onDemand",
        label: "memory 筆記",
        absolutePath: path,
        status: "present",
      });
    }
  }
  return [index, ...topics];
}
```

修改 `src/inspect/discover.ts`：import `collectMemoryEntries`，在 `return` 前把 memory entries 接到 `entries` 後面。`readResolverSettings` 的結果要傳進 `collectMemoryEntries`。完整的組合段是：

```ts
  const instructions = expandImports(
    collectInstructionEntries({
      cwd,
      configDir,
      managedPolicyPath: options.managedPolicyPath,
      excludes: settings.excludes,
    }),
    { cwd, configDir, home: options.home },
  );
  const entries = [
    ...instructions,
    ...collectMemoryEntries({ cwd, configDir, env: options.env, settings }),
  ];
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `pnpm test`

Expected: PASS，包含前面的路徑、settings、glob、markdown、preview、instructions、discover。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/memory.ts src/inspect/discover.ts src/inspect/discover.test.ts
git commit -m "$(cat <<'EOF'
Show auto memory load state in inspect

EOF
)"
```

---

### Task 9: TUI 與 inspect 指令

**Files:**
- Create: `src/inspect/watch-targets.ts`
- Create: `src/inspect/watch-targets.test.ts`
- Create: `src/ui/InspectView.tsx`
- Create: `src/ui/InspectApp.tsx`
- Modify: `src/cli.tsx`

**Interfaces:**
- Consumes: `discoverInspectModel`、`readPreview`、`InspectModel`、`InspectEntry`、`defaultManagedPolicyPath`。
- Produces: `watchTargets(model: InspectModel): string[]`，以及 CLI 指令 `inspect`。

`watchTargets` 回傳去重後的路徑：

- `model.configDir`
- `model.cwd`
- 每個 entry 的 `absolutePath`
- 每個 entry 的父目錄

chokidar 用這些路徑，`ignoreInitial: true`。變更時重新 `discoverInspectModel`。忽略函式要跳過 `**/node_modules/**` 與 `**/.git/**`，避免盯著整個 repo 的依賴。

UI：

- `InspectView` 不讀檔。props 是 `model`、`selectedIndex`、`preview: Preview`、`stacked: boolean`。
- `columns < 80` 時 `stacked` 為 true，改成上下排；否則左右，左欄寬 36。
- 啟動區標題 `啟動時載入`。按需區只有在有項目時才顯示標題 `按需才載入`。
- 選中列用 cyan。狀態後綴：`missing` → `未找到`，`external` → `外部，可能尚未核准`，`excluded` → `已排除`，`skipped-too-large` → `Claude 會略過`，`disabled` → `未載入`。`trustNote` 與 `detail` 用 dim。
- 右欄（或下欄）顯示 `preview.text`。若有 `loadBoundaryLine`，在該行前插入一行 `──── 啟動時不載入 ────`。沒有 text 就顯示 `preview.notice`。
- 標題列顯示 `Inspect <cwd>`，下面是 `headerNotes` 與 `warnings`。警告用 yellow。
- 底部 `j/k 選擇   [ ] 捲動   q 離開`。

`InspectApp`：

- props：`options: DiscoverOptions`。
- `j`/`k`/上下把 selectedIndex 限制在 entries 範圍。換列時 preview scroll 歸零。
- `[` scroll 減 1，`]` scroll 加 1，不小於 0，也不超過可捲行數。
- `q` 呼叫 `useApp().exit()`。
- 非 TTY 時 `useInput` 的 `isActive` 用 `Boolean(isRawModeSupported)`，跟 `src/ui/App.tsx` 一樣。
- 選中按需項目時仍呼叫 `readPreview`；preview 模組會回「按需載入，不預覽內容」。

`src/cli.tsx` 加：

```ts
program
  .command("inspect")
  .description("檢視這個目錄啟動 Claude 時會載入的 CLAUDE.md、rules 與 auto memory")
  .option("--dir <path>", "要解析的目錄，預設為目前工作目錄")
  .action((opts: { dir?: string }) => {
    const cwd = resolve(opts.dir ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      console.error(`目錄不存在：${cwd}`);
      process.exitCode = 1;
      return;
    }
    render(
      <InspectApp
        options={{
          cwd,
          env: process.env,
          home: homedir(),
          managedPolicyPath: defaultManagedPolicyPath(),
        }}
      />,
    );
  });
```

需要的 import：`existsSync`、`statSync`、`homedir`、`resolve`、`InspectApp`、`defaultManagedPolicyPath`。不要動既有的 `init` / `watch` / `version`。

- [ ] **Step 1: 寫 watch target 的失敗測試**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { InspectModel } from "./types.js";
import { watchTargets } from "./watch-targets.js";

test("watchTargets 包含 config、cwd、項目路徑與父目錄，且不重複", () => {
  const model: InspectModel = {
    cwd: "/proj",
    configDir: "/home/me/.claude",
    headerNotes: [],
    warnings: [],
    entries: [
      {
        id: "launch:/proj/CLAUDE.md",
        section: "launch",
        label: "CLAUDE.md",
        absolutePath: "/proj/CLAUDE.md",
        status: "present",
      },
    ],
  };
  const targets = watchTargets(model);
  assert.equal(new Set(targets).size, targets.length);
  assert.equal(targets.includes("/proj"), true);
  assert.equal(targets.includes("/proj/CLAUDE.md"), true);
  assert.equal(targets.includes("/home/me/.claude"), true);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --import tsx --test src/inspect/watch-targets.test.ts`

Expected: FAIL，模組不存在。

- [ ] **Step 3: 寫 watch-targets、畫面與指令**

`src/inspect/watch-targets.ts`：

```ts
import { dirname } from "node:path";
import { InspectModel } from "./types.js";

export function watchTargets(model: InspectModel): string[] {
  const targets = new Set<string>([model.cwd, model.configDir]);
  for (const entry of model.entries) {
    targets.add(entry.absolutePath);
    targets.add(dirname(entry.absolutePath));
  }
  return [...targets];
}
```

`src/ui/InspectView.tsx`：

```tsx
import { Box, Text } from "ink";
import { Preview } from "../inspect/preview.js";
import { InspectModel, InspectStatus } from "../inspect/types.js";

const STATUS_SUFFIX: Partial<Record<InspectStatus, string>> = {
  missing: "未找到",
  external: "外部，可能尚未核准",
  excluded: "已排除",
  "skipped-too-large": "Claude 會略過",
  disabled: "未載入",
};

function previewLines(preview: Preview): string[] {
  if (!preview.text) return [preview.notice ?? ""];
  const lines = preview.text.split("\n");
  if (preview.loadBoundaryLine === undefined) return lines;
  return [
    ...lines.slice(0, preview.loadBoundaryLine),
    "──── 啟動時不載入 ────",
    ...lines.slice(preview.loadBoundaryLine),
  ];
}

export function InspectView({
  model,
  selectedIndex,
  preview,
  previewScroll,
  stacked,
}: {
  model: InspectModel;
  selectedIndex: number;
  preview: Preview;
  previewScroll: number;
  stacked: boolean;
}) {
  const launch = model.entries.filter((entry) => entry.section === "launch");
  const onDemand = model.entries.filter((entry) => entry.section === "onDemand");
  const lines = previewLines(preview).slice(previewScroll, previewScroll + 20);

  const list = (
    <Box flexDirection="column" width={stacked ? undefined : 36}>
      <Text bold>啟動時載入</Text>
      {launch.map((entry) => {
        const index = model.entries.indexOf(entry);
        const suffix = STATUS_SUFFIX[entry.status];
        return (
          <Text key={entry.id} color={index === selectedIndex ? "cyan" : undefined}>
            {index === selectedIndex ? "› " : "  "}
            {entry.label}
            {suffix ? `  ${suffix}` : ""}
            {entry.detail ? <Text dimColor>{`  ${entry.detail}`}</Text> : null}
            {entry.trustNote ? <Text dimColor>{`  ${entry.trustNote}`}</Text> : null}
          </Text>
        );
      })}
      {onDemand.length > 0 ? <Text bold>按需才載入</Text> : null}
      {onDemand.map((entry) => {
        const index = model.entries.indexOf(entry);
        return (
          <Text key={entry.id} color={index === selectedIndex ? "cyan" : undefined}>
            {index === selectedIndex ? "› " : "  "}
            {entry.label}
            <Text dimColor>{`  ${entry.absolutePath}`}</Text>
            {entry.detail ? <Text dimColor>{`  ${entry.detail}`}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );

  const pane = (
    <Box flexDirection="column" flexGrow={1}>
      {lines.map((line, index) => (
        <Text key={`${previewScroll + index}`}>{line}</Text>
      ))}
    </Box>
  );

  return (
    <Box flexDirection="column">
      <Text bold>Inspect {model.cwd}</Text>
      {model.headerNotes.map((note) => (
        <Text key={note} dimColor>{note}</Text>
      ))}
      {model.warnings.map((warning) => (
        <Text key={warning} color="yellow">{warning}</Text>
      ))}
      <Box flexDirection={stacked ? "column" : "row"} marginTop={1}>
        {list}
        {pane}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>j/k 選擇   [ ] 捲動   q 離開</Text>
      </Box>
    </Box>
  );
}
```

`src/ui/InspectApp.tsx`：

```tsx
import { useEffect, useState } from "react";
import { useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { discoverInspectModel } from "../inspect/discover.js";
import { readPreview } from "../inspect/preview.js";
import { DiscoverOptions, InspectModel } from "../inspect/types.js";
import { watchTargets } from "../inspect/watch-targets.js";
import { InspectView } from "./InspectView.js";

function lineCount(text: string | undefined, boundary: number | undefined): number {
  if (!text) return 1;
  const extra = boundary === undefined ? 0 : 1;
  return text.split("\n").length + extra;
}

export function InspectApp({ options }: { options: DiscoverOptions }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [model, setModel] = useState<InspectModel>(() => discoverInspectModel(options));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewScroll, setPreviewScroll] = useState(0);
  const [columns, setColumns] = useState(process.stdout.columns ?? 80);

  useEffect(() => {
    const onResize = () => setColumns(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const initial = discoverInspectModel(options);
    setModel(initial);
    const watcher = chokidar.watch(watchTargets(initial), {
      ignoreInitial: true,
      ignored: ["**/node_modules/**", "**/.git/**"],
    });
    const refresh = () => {
      const next = discoverInspectModel(options);
      watcher.add(watchTargets(next));
      setModel(next);
      setSelectedIndex((index) => Math.min(index, Math.max(next.entries.length - 1, 0)));
    };
    watcher.on("add", refresh).on("change", refresh).on("unlink", refresh);
    return () => {
      void watcher.close();
    };
  }, [options]);

  const selected = model.entries[selectedIndex];
  const preview = selected ? readPreview(selected) : { notice: "未找到" };
  const maxScroll = Math.max(lineCount(preview.text, preview.loadBoundaryLine) - 1, 0);

  useInput(
    (input, key) => {
      if (input === "q") exit();
      if (input === "j" || key.downArrow) {
        setSelectedIndex((index) => Math.min(index + 1, Math.max(model.entries.length - 1, 0)));
        setPreviewScroll(0);
      }
      if (input === "k" || key.upArrow) {
        setSelectedIndex((index) => Math.max(index - 1, 0));
        setPreviewScroll(0);
      }
      if (input === "]") setPreviewScroll((scroll) => Math.min(scroll + 1, maxScroll));
      if (input === "[") setPreviewScroll((scroll) => Math.max(scroll - 1, 0));
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  return (
    <InspectView
      model={model}
      selectedIndex={selectedIndex}
      preview={preview}
      previewScroll={previewScroll}
      stacked={columns < 80}
    />
  );
}
```

import 用 `useApp, useInput, useStdin`，不要用 `useStdout`。

在 `src/cli.tsx` 加上 Step 開頭那段 command。`existsSync` / `statSync` 從 `node:fs` 加到既有 import。`homedir` 從 `node:os`。`resolve` 加到既有 `node:path` import。

- [ ] **Step 4: 跑測試與型別檢查**

Run: `pnpm test && pnpm run typecheck`

Expected: PASS。若 Ink 的 `Box width` 型別不接受 `undefined`，stack 時不要傳 `width`，改成兩個分支而不是 `width={stacked ? undefined : 36}`。

- [ ] **Step 5: Commit**

```bash
git add src/inspect/watch-targets.ts src/inspect/watch-targets.test.ts src/ui/InspectView.tsx src/ui/InspectApp.tsx src/cli.tsx
git commit -m "$(cat <<'EOF'
Add read-only inspect TUI for Claude memory files

EOF
)"
```

---

## Self-review 備註（給寫計畫的人，實作者不用做）

- 規格裡的五格空列、按需不預覽、外部 import 不讀、settings 不顯示、環境變數只看 TUI process、MEMORY.md 邊界、4 MiB、trust 註記、live reload、獨立指令，都有對應 task。
- 已知落差寫在 Global Constraints：不讀 policy settings，所以組織層 excludes / autoMemoryDirectory 不會反映。
- 測試機祖先目錄可能已有 `CLAUDE.md`。instructions 測試不要假設祖先清單只有 fixture 裡的檔。
- Task 6 的 `walk.ts` 以「用 stat 判斷 symlink 目錄並跳過」那一版為準。
- Task 9 的 App 以 `useStdin` 與「watcher 只依 options 建立，refresh 時 add 新路徑」那一版為準。
