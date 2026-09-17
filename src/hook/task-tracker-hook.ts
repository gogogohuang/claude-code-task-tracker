import { applyHookEvent } from "./apply-event.js";
import { HookPayloadSchema } from "../schema.js";
import { appendDebugLog, readTaskState, withSessionLock, writeTaskState } from "../store.js";

/**
 * 這支腳本會被 Claude Code 以 PreToolUse／PostToolUse／SessionStart hook
 * 的形式呼叫。matcher 都設定為 "*"（見 install-hooks.ts），涵蓋所有工具
 * 與工作階段開始，讓還沒呼叫工具時 watch 也能看到 session。
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

  await withSessionLock(payloadResult.data.session_id, () => {
    applyHookEvent(payloadResult.data, { readTaskState, writeTaskState, appendDebugLog });
  });
}

main().catch((err) => {
  appendDebugLog(`未預期的例外: ${(err as Error).message}`);
});
