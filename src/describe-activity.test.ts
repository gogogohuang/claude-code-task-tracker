import assert from "node:assert/strict";
import test from "node:test";
import { describeActivity } from "./describe-activity.js";

function describe(input: {
  toolName: string;
  toolInput?: unknown;
  cwd?: string;
  phase?: "running" | "done";
}): string {
  return describeActivity({
    toolName: input.toolName,
    toolInput: input.toolInput,
    cwd: input.cwd,
    phase: input.phase ?? "running",
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
    "正在使用 Skill",
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
