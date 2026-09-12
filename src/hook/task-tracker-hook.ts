import { describeActivity } from "../describe-activity.js";
import {
  Activity,
  HookPayloadSchema,
  TaskCreateInputSchema,
  TaskItem,
  TaskItemSchema,
  TaskUpdateInputSchema,
  TodoItem,
  TodoWriteInputSchema,
} from "../schema.js";
import { appendDebugLog, readTaskState, writeTaskState } from "../store.js";

/**
 * 這支腳本會被 Claude Code 以 PreToolUse／PostToolUse hook 的形式呼叫，
 * matcher 都設定為 "*"（見 commands/init.ts 產生的設定），涵蓋所有工具，
 * 不只 TodoWrite/Task 系列。Claude Code 會把該次工具呼叫的 JSON payload
 * 從 stdin 傳進來，這裡做兩件事：
 * 1. 不論哪個工具，都更新 activity 欄位（PreToolUse 標 running，
 *    PostToolUse 標 done），讓沒開 todo/task 清單時也能看到目前在做什麼。
 * 2. PostToolUse 若是 TodoWrite/TaskCreate/TaskUpdate/TaskList，額外跑
 *    todos/tasks 的專屬邏輯。
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

/** 從 TaskCreate 的 tool_response 猜測新產生的 taskId 欄位（沒有公開 schema 可查）。 */
function extractCreatedTaskId(toolResponse: unknown): string | undefined {
  if (!toolResponse || typeof toolResponse !== "object") return undefined;
  const obj = toolResponse as Record<string, unknown>;
  const nestedTask = obj.task as Record<string, unknown> | undefined;
  const candidate = obj.taskId ?? obj.id ?? nestedTask?.id;
  return typeof candidate === "string" ? candidate : undefined;
}

/** 從 TaskList 的 tool_response 猜測完整任務清單（同樣沒有公開 schema 可查）。 */
function extractTaskList(toolResponse: unknown): TaskItem[] | undefined {
  if (!toolResponse) return undefined;
  const rawList = Array.isArray(toolResponse)
    ? toolResponse
    : typeof toolResponse === "object"
      ? (toolResponse as Record<string, unknown>).tasks
      : undefined;
  if (!Array.isArray(rawList)) return undefined;

  const parsed = rawList
    .map((item) => TaskItemSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
  return parsed.length > 0 ? parsed : undefined;
}

function mergeIdLists(previous: string[] | undefined, added: string[] | undefined): string[] | undefined {
  if (!previous && !added) return undefined;
  return Array.from(new Set([...(previous ?? []), ...(added ?? [])]));
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
  const updatedAt = new Date().toISOString();
  const existing = readTaskState(payload.session_id);

  const phase = payload.hook_event_name === "PreToolUse" ? "running" : "done";
  const activity: Activity = {
    toolName: payload.tool_name,
    phase,
    summary: describeActivity({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      cwd: payload.cwd,
      phase,
    }),
    at: updatedAt,
  };

  const persist = (todos?: TodoItem[], tasks?: Record<string, TaskItem>) => {
    try {
      writeTaskState({
        sessionId: payload.session_id,
        cwd: payload.cwd,
        updatedAt,
        todos: todos ?? existing?.todos,
        tasks: tasks ?? existing?.tasks,
        activity,
      });
    } catch (err) {
      appendDebugLog(`寫入狀態檔失敗: ${(err as Error).message}`);
    }
  };

  // PreToolUse：不管哪個工具，只更新 activity（此時工具還沒執行，沒有
  // tool_response，也不該動 todos/tasks）。
  if (payload.hook_event_name === "PreToolUse") {
    persist(undefined);
    return;
  }

  if (payload.tool_name === "TodoWrite") {
    const inputResult = TodoWriteInputSchema.safeParse(payload.tool_input);
    if (!inputResult.success) {
      appendDebugLog(`TodoWrite tool_input 格式不符預期: ${inputResult.error.message}`);
      persist(undefined);
      return;
    }
    persist(inputResult.data.todos);
    return;
  }

  if (payload.tool_name === "TaskCreate") {
    const inputResult = TaskCreateInputSchema.safeParse(payload.tool_input);
    if (!inputResult.success) {
      appendDebugLog(`TaskCreate tool_input 格式不符預期: ${inputResult.error.message}`);
      persist(undefined);
      return;
    }
    const id = extractCreatedTaskId(payload.tool_response);
    if (!id) {
      appendDebugLog("TaskCreate tool_response 找不到 taskId，略過這次更新");
      persist(undefined);
      return;
    }
    const tasks = { ...existing?.tasks };
    tasks[id] = {
      id,
      subject: inputResult.data.subject,
      description: inputResult.data.description,
      activeForm: inputResult.data.activeForm,
      status: "pending",
    };
    persist(undefined, tasks);
    return;
  }

  if (payload.tool_name === "TaskUpdate") {
    const inputResult = TaskUpdateInputSchema.safeParse(payload.tool_input);
    if (!inputResult.success) {
      appendDebugLog(`TaskUpdate tool_input 格式不符預期: ${inputResult.error.message}`);
      persist(undefined);
      return;
    }
    const input = inputResult.data;
    const previous = existing?.tasks?.[input.taskId];
    const merged: TaskItem = {
      id: input.taskId,
      status: input.status ?? previous?.status ?? "pending",
      subject: input.subject ?? previous?.subject,
      description: input.description ?? previous?.description,
      activeForm: previous?.activeForm,
      owner: input.owner ?? previous?.owner,
      blockedBy: mergeIdLists(previous?.blockedBy, input.addBlockedBy),
      blocks: mergeIdLists(previous?.blocks, input.addBlocks),
    };
    const tasks = { ...existing?.tasks, [input.taskId]: merged };
    persist(undefined, tasks);
    return;
  }

  if (payload.tool_name === "TaskList") {
    const list = extractTaskList(payload.tool_response);
    if (!list) {
      appendDebugLog("TaskList tool_response 格式不符預期，略過 resync");
      persist(undefined);
      return;
    }
    const tasks: Record<string, TaskItem> = {};
    for (const item of list) tasks[item.id] = item;
    persist(undefined, tasks);
    return;
  }

  // 其他工具：只更新 activity。
  persist(undefined);
}

main().catch((err) => {
  appendDebugLog(`未預期的例外: ${(err as Error).message}`);
});
