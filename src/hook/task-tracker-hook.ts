import { HookPayloadSchema, TodoWriteInputSchema } from "../schema.js";
import { appendDebugLog, writeTaskState } from "../store.js";

/**
 * 這支腳本會被 Claude Code 以 PostToolUse hook 的形式呼叫，
 * matcher 設定為 TodoWrite（見 commands/init.ts 產生的設定）。
 * Claude Code 會把該次工具呼叫的 JSON payload 從 stdin 傳進來，
 * 這裡的任務只有一件事：把最新的 todos 落地成檔案，讓 TUI 可以讀。
 *
 * 原則：無論發生什麼事都要 exit 0，絕不能讓 hook 失敗而打斷使用者的
 * Claude Code session；所有錯誤都寫進 debug log，不往外拋。
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  const raw = await readStdin();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    appendDebugLog(`JSON parse 失敗: ${(err as Error).message}`);
    return;
  }

  const payloadResult = HookPayloadSchema.safeParse(parsedJson);
  if (!payloadResult.success) {
    appendDebugLog(`Hook payload 格式不符預期: ${payloadResult.error.message}`);
    return;
  }
  const payload = payloadResult.data;

  // 只處理 TodoWrite；其他工具的 PostToolUse 事件直接忽略。
  if (payload.tool_name !== "TodoWrite") {
    return;
  }

  const inputResult = TodoWriteInputSchema.safeParse(payload.tool_input);
  if (!inputResult.success) {
    appendDebugLog(`TodoWrite tool_input 格式不符預期: ${inputResult.error.message}`);
    return;
  }

  try {
    writeTaskState({
      sessionId: payload.session_id,
      cwd: payload.cwd,
      updatedAt: new Date().toISOString(),
      todos: inputResult.data.todos,
    });
  } catch (err) {
    appendDebugLog(`寫入狀態檔失敗: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  appendDebugLog(`未預期的例外: ${(err as Error).message}`);
});
