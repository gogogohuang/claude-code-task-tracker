import assert from "node:assert/strict";
import test from "node:test";
import { describeActivity } from "./describe-activity.js";

function describe(input: {
  toolName: string;
  toolInput?: unknown;
  cwd?: string;
  phase?: "running" | "done";
  locale?: "zh" | "en";
}): string {
  return describeActivity({
    toolName: input.toolName,
    toolInput: input.toolInput,
    cwd: input.cwd,
    phase: input.phase ?? "running",
    locale: input.locale ?? "zh",
  });
}

test("非物件的 tool_input 退回使用工具，不丟例外", () => {
  assert.equal(describe({ toolName: "Read", toolInput: null }), "正在使用 Read");
  assert.equal(describe({ toolName: "Read", toolInput: "src/schema.ts" }), "正在使用 Read");
  assert.equal(describe({ toolName: "Read", toolInput: [] }), "正在使用 Read");
  assert.equal(describe({ toolName: "Skill", toolInput: null, phase: "done" }), "已使用 Skill");
});

test("文件沒列的工具不猜欄位，工具名原樣保留", () => {
  assert.equal(
    describe({
      toolName: "Skill",
      toolInput: { skill: "commit", description: "Commit the change" },
    }),
    "正在使用技能：commit",
  );
  assert.equal(
    describe({ toolName: "mcp__playwright__browser_click", toolInput: { ref: "1" } }),
    "正在使用 mcp__playwright__browser_click",
  );
});

test("Read 在 cwd 底下顯示相對路徑，外面只顯示檔名", () => {
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/proj/src/schema.ts" },
      cwd: "/proj",
    }),
    "正在讀取 src/schema.ts",
  );
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/other/secret.txt" },
      cwd: "/proj",
    }),
    "正在讀取 secret.txt",
  );
  assert.equal(
    describe({ toolName: "Read", toolInput: { file_path: "/tmp/notes.txt" } }),
    "正在讀取 notes.txt",
  );
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/proj/src/schema.ts" },
      cwd: "/proj",
      phase: "done",
    }),
    "已讀取 src/schema.ts",
  );
});

test("路徑比對先正規化反斜線，並要求 cwd 後面有路徑分隔", () => {
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "C:\\project\\src\\index.ts" },
      cwd: "C:\\project\\",
    }),
    "正在讀取 src/index.ts",
  );
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/proj-extra/secret.txt" },
      cwd: "/proj",
    }),
    "正在讀取 secret.txt",
  );
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/proj" },
      cwd: "/proj",
    }),
    "正在讀取 proj",
  );
});

test("缺路徑、空白路徑、過長片段都依規則處理", () => {
  assert.equal(describe({ toolName: "Read", toolInput: {} }), "正在使用 Read");
  assert.equal(describe({ toolName: "Read", toolInput: { file_path: "   " } }), "正在使用 Read");
  const exact = "b".repeat(80);
  assert.equal(
    describe({ toolName: "Read", toolInput: { file_path: `/tmp/${exact}` } }),
    `正在讀取 ${exact}`,
  );
  const tooLong = "a".repeat(81);
  assert.equal(
    describe({ toolName: "Read", toolInput: { file_path: `/tmp/${tooLong}` } }),
    `正在讀取 ${"a".repeat(79)}…`,
  );
});

test("Edit 與 NotebookEdit 是修改，Write 是寫入，而且不帶檔案內容", () => {
  assert.equal(
    describe({
      toolName: "Edit",
      toolInput: { file_path: "/proj/src/a.ts", old_string: "OLD", new_string: "NEW" },
      cwd: "/proj",
    }),
    "正在修改 src/a.ts",
  );
  assert.equal(
    describe({
      toolName: "Write",
      toolInput: { file_path: "/proj/notes.txt", content: "SECRET_CONTENT" },
      cwd: "/proj",
    }),
    "正在寫入 notes.txt",
  );
  assert.equal(
    describe({
      toolName: "NotebookEdit",
      toolInput: { file_path: "/proj/notes.ipynb" },
      cwd: "/proj",
    }),
    "正在修改 notes.ipynb",
  );
  assert.equal(describe({ toolName: "NotebookEdit", toolInput: {} }), "正在使用 NotebookEdit");
});

test("Bash 與 PowerShell 優先用 description，否則只取指令第一行", () => {
  assert.equal(
    describe({
      toolName: "Bash",
      toolInput: { command: "rm -rf /", description: "Clean build" },
    }),
    "正在執行 Clean build",
  );
  assert.equal(
    describe({
      toolName: "Bash",
      toolInput: { description: "   ", command: "npm   test" },
    }),
    "正在執行 npm test",
  );
  assert.equal(
    describe({
      toolName: "Bash",
      toolInput: { command: "npm test\necho SECRET_LINE" },
    }),
    "正在執行 npm test",
  );
  assert.equal(
    describe({ toolName: "Bash", toolInput: { command: "\nnpm test" } }),
    "正在使用 Bash",
  );
  assert.equal(
    describe({
      toolName: "Bash",
      toolInput: { description: `Run\n${"x".repeat(90)}` },
    }),
    `正在執行 Run ${"x".repeat(75)}…`,
  );
  assert.equal(
    describe({
      toolName: "PowerShell",
      toolInput: { command: "Get-ChildItem", description: "List files" },
      phase: "done",
    }),
    "已執行 List files",
  );
});

test("搜尋、抓取與尋找用各自的受詞，不讀 prompt", () => {
  assert.equal(
    describe({ toolName: "Glob", toolInput: { pattern: "**/*.ts" } }),
    "正在尋找 **/*.ts",
  );
  assert.equal(
    describe({ toolName: "Grep", toolInput: { pattern: "TODO" }, phase: "done" }),
    "已搜尋程式碼：TODO",
  );
  assert.equal(describe({ toolName: "Grep", toolInput: { pattern: "  " } }), "正在使用 Grep");
  assert.equal(
    describe({ toolName: "WebSearch", toolInput: { query: "react hooks" } }),
    "正在搜尋網頁：react hooks",
  );
  assert.equal(
    describe({
      toolName: "WebFetch",
      toolInput: { url: "https://example.com", prompt: "EXTRACT_SECRET" },
    }),
    "正在抓取 https://example.com",
  );
  assert.equal(
    describe({ toolName: "WebFetch", toolInput: { prompt: "EXTRACT_SECRET" } }),
    "正在使用 WebFetch",
  );
});

test("Agent 要同時有類型和短描述，AskUserQuestion 只用第一題", () => {
  assert.equal(
    describe({
      toolName: "Agent",
      toolInput: {
        subagent_type: "Explore",
        description: "Find API endpoints",
        prompt: "LONG_PROMPT",
      },
    }),
    "正在交給 Explore：Find API endpoints",
  );
  assert.equal(
    describe({ toolName: "Agent", toolInput: { description: "Find API endpoints" } }),
    "正在使用 Agent",
  );
  assert.equal(
    describe({
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          { question: "Which framework?" },
          { question: "SECOND_QUESTION" },
        ],
      },
    }),
    "正在詢問：Which framework?",
  );
  assert.equal(describe({ toolName: "AskUserQuestion", toolInput: { questions: [] } }), "正在使用 AskUserQuestion");
});

test("計畫、清單和任務工具寫固定動作，不搬正文或 taskId", () => {
  assert.equal(
    describe({
      toolName: "ExitPlanMode",
      toolInput: { plan: "## SECRET_PLAN\n1. Extract" },
    }),
    "正在等待核准計畫",
  );
  assert.equal(
    describe({ toolName: "ExitPlanMode", toolInput: {}, phase: "done" }),
    "已送出計畫",
  );
  assert.equal(
    describe({
      toolName: "TodoWrite",
      toolInput: { todos: [{ content: "修正 bug", activeForm: "正在修正 bug", status: "in_progress" }] },
    }),
    "正在更新任務清單",
  );
  assert.equal(
    describe({ toolName: "TaskCreate", toolInput: { subject: "修正登入", description: "LONG" } }),
    "正在建立任務：修正登入",
  );
  assert.equal(describe({ toolName: "TaskCreate", toolInput: {} }), "正在建立任務");
  assert.equal(
    describe({ toolName: "TaskUpdate", toolInput: { taskId: "task-99", subject: "修正登入" } }),
    "正在更新任務：修正登入",
  );
  assert.equal(
    describe({ toolName: "TaskUpdate", toolInput: { taskId: "task-99" }, phase: "done" }),
    "已更新任務",
  );
  assert.equal(describe({ toolName: "TaskList", toolInput: {} }), "正在讀取任務清單");
  assert.equal(
    describe({ toolName: "Workflow", toolInput: { name: "linego-feature-workflow" } }),
    "正在執行 workflow linego-feature-workflow",
  );
  assert.equal(
    describe({
      toolName: "Workflow",
      toolInput: { name: "linego-feature-workflow" },
      phase: "done",
    }),
    "已啟動 workflow linego-feature-workflow",
  );
});

test("en locale：主要工具句", () => {
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/proj/src/a.ts" },
      cwd: "/proj",
      locale: "en",
    }),
    "Reading src/a.ts",
  );
  assert.equal(
    describe({
      toolName: "Read",
      toolInput: { file_path: "/proj/src/a.ts" },
      cwd: "/proj",
      phase: "done",
      locale: "en",
    }),
    "Read src/a.ts",
  );
  assert.equal(
    describe({ toolName: "ExitPlanMode", toolInput: {}, locale: "en" }),
    "Waiting for plan approval",
  );
  assert.equal(describe({ toolName: "Read", toolInput: null, locale: "en" }), "Using Read");
  assert.equal(
    describe({ toolName: "AskUserQuestion", toolInput: { questions: [{ question: "Go?" }] }, locale: "en" }),
    "Asking: Go?",
  );
});

