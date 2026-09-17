import { describeActivity } from "../describe-activity.js";
import { resolveLocale } from "../locale.js";
import { readFileSync } from "node:fs";
import {
  Activity,
  HookPayload,
  TaskCreateInputSchema,
  TaskItem,
  TaskItemSchema,
  TaskStatus,
  TaskUpdateInputSchema,
  TodoItem,
  TodoWriteInputSchema,
  WorkflowRun,
} from "../schema.js";
import { TaskState } from "../schema.js";
import { normalizeOptionalCwd } from "../session-preference.js";
import { extractRunId, journalPathFor, sessionDirFromTranscript } from "../workflow/paths.js";
import { parseWorkflowMeta } from "../workflow/parse-meta.js";

export interface ApplyHookDeps {
  readTaskState: (sessionId: string) => TaskState | null;
  writeTaskState: (state: TaskState) => void;
  appendDebugLog: (message: string) => void;
  now?: () => Date;
}

function extractCreatedTaskId(toolResponse: unknown): string | undefined {
  if (!toolResponse || typeof toolResponse !== "object") return undefined;
  const obj = toolResponse as Record<string, unknown>;
  const nestedTask = obj.task as Record<string, unknown> | undefined;
  const candidate = obj.taskId ?? obj.id ?? nestedTask?.id;
  return typeof candidate === "string" ? candidate : undefined;
}

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

function sessionStartSummary(payload: HookPayload): string {
  if (payload.source === "resume") return "已還原工作階段";
  if (payload.source === "compact") return "已壓縮工作階段";
  return "工作階段已開始";
}

function mergeTodoLists(previous: TodoItem[] | undefined, incoming: TodoItem[]): TodoItem[] {
  if (!previous || previous.length === 0) return incoming;
  const next = [...previous];
  for (const item of incoming) {
    const index = next.findIndex((row) => (item.id && row.id === item.id) || row.content === item.content);
    if (index >= 0) next[index] = { ...next[index], ...item };
    else next.push(item);
  }
  return next;
}

function upsertTask(
  previous: Record<string, TaskItem> | undefined,
  id: string,
  patch: Omit<TaskItem, "id"> & { id?: string },
): Record<string, TaskItem> {
  const current = previous?.[id];
  return {
    ...previous,
    [id]: {
      id,
      status: patch.status,
      subject: patch.subject ?? current?.subject,
      description: patch.description ?? current?.description,
      activeForm: patch.activeForm ?? current?.activeForm,
      owner: patch.owner ?? current?.owner,
      blockedBy: patch.blockedBy ?? current?.blockedBy,
      blocks: patch.blocks ?? current?.blocks,
    },
  };
}

function lifecycleActivity(kind: "created" | "completed", subject: string | undefined, at: string): Activity {
  const summary = kind === "created" ? "已建立任務" : "已完成任務";
  return {
    toolName: kind === "created" ? "TaskCreate" : "TaskUpdate",
    phase: "done",
    summary: subject ? `${summary} ${subject}` : summary,
    at,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function workflowSource(toolInput: unknown): string | undefined {
  const input = asRecord(toolInput);
  if (typeof input?.script === "string") return input.script;
  if (typeof input?.scriptPath !== "string") return undefined;
  try {
    return readFileSync(input.scriptPath, "utf-8");
  } catch {
    return undefined;
  }
}

function seedWorkflow(payload: HookPayload, previous: WorkflowRun | undefined): WorkflowRun | undefined {
  if (payload.tool_name !== "Workflow") return previous;
  const source = workflowSource(payload.tool_input);
  const meta = source ? parseWorkflowMeta(source) : undefined;
  if (!meta) return previous;
  const runId = extractRunId(payload.tool_input, payload.tool_response);
  if (!runId || !payload.transcript_path) return previous;
  return {
    runId,
    name: meta.name,
    journalPath: journalPathFor(payload.transcript_path, runId),
    phases: meta.phases.map((title) => ({ title, status: "pending" as const })),
  };
}

export function applyHookEvent(payload: HookPayload, deps: ApplyHookDeps): void {
  const updatedAt = (deps.now?.() ?? new Date()).toISOString();
  const existing = deps.readTaskState(payload.session_id);

  const persist = (todos?: TodoItem[], tasks?: Record<string, TaskItem>, activity?: Activity) => {
    try {
      const cwd =
        normalizeOptionalCwd(payload.cwd) ??
        normalizeOptionalCwd(existing?.cwd) ??
        normalizeOptionalCwd(process.cwd());
      deps.writeTaskState({
        sessionId: payload.session_id,
        cwd,
        claudeSessionDir: payload.transcript_path
          ? sessionDirFromTranscript(payload.transcript_path)
          : existing?.claudeSessionDir,
        updatedAt,
        todos: todos ?? existing?.todos,
        tasks: tasks ?? existing?.tasks,
        activity,
        workflow: seedWorkflow(payload, existing?.workflow),
      });
    } catch (err) {
      deps.appendDebugLog(`寫入狀態檔失敗: ${(err as Error).message}`);
    }
  };

  if (payload.hook_event_name === "SessionStart") {
    const keepRunning = existing?.activity?.phase === "running" ? existing.activity : undefined;
    persist(undefined, undefined, keepRunning ?? {
      toolName: "SessionStart",
      phase: "done",
      summary: sessionStartSummary(payload),
      at: updatedAt,
    });
    return;
  }

  if (payload.hook_event_name === "TaskCreated" || payload.hook_event_name === "TaskCompleted") {
    const id = payload.task_id;
    if (!id) {
      deps.appendDebugLog(`${payload.hook_event_name} 缺少 task_id，略過這次更新`);
      return;
    }
    const alreadyCompleted = existing?.tasks?.[id]?.status === "completed";
    const status: TaskStatus =
      payload.hook_event_name === "TaskCompleted" || alreadyCompleted ? "completed" : "in_progress";
    persist(
      undefined,
      upsertTask(existing?.tasks, id, {
        status,
        subject: payload.task_subject,
        description: payload.task_description,
        owner: payload.teammate_name,
      }),
      lifecycleActivity(payload.hook_event_name === "TaskCreated" ? "created" : "completed", payload.task_subject, updatedAt),
    );
    return;
  }

  const toolName = payload.tool_name;
  if (!toolName) {
    deps.appendDebugLog("Hook payload 缺少 tool_name，略過這次更新");
    return;
  }

  const phase = payload.hook_event_name === "PreToolUse" ? "running" : "done";
  const activity: Activity = {
    toolName,
    phase,
    summary: describeActivity({
      toolName,
      toolInput: payload.tool_input,
      cwd: payload.cwd,
      phase,
      locale: resolveLocale(process.env),
    }),
    at: updatedAt,
  };

  if (payload.hook_event_name === "PreToolUse") {
    persist(undefined, undefined, activity);
    return;
  }

  if (toolName === "TodoWrite") {
    const inputResult = TodoWriteInputSchema.safeParse(payload.tool_input);
    if (!inputResult.success) {
      deps.appendDebugLog(`TodoWrite tool_input 格式不符預期: ${inputResult.error.message}`);
      persist(undefined, undefined, activity);
      return;
    }
    const todos = inputResult.data.merge
      ? mergeTodoLists(existing?.todos, inputResult.data.todos)
      : inputResult.data.todos;
    persist(todos, undefined, activity);
    return;
  }

  if (toolName === "TaskCreate") {
    const inputResult = TaskCreateInputSchema.safeParse(payload.tool_input);
    if (!inputResult.success) {
      deps.appendDebugLog(`TaskCreate tool_input 格式不符預期: ${inputResult.error.message}`);
      persist(undefined, undefined, activity);
      return;
    }
    const id = extractCreatedTaskId(payload.tool_response) ?? payload.task_id;
    if (!id) {
      deps.appendDebugLog("TaskCreate tool_response 找不到 taskId，略過這次更新");
      persist(undefined, undefined, activity);
      return;
    }
    persist(
      undefined,
      upsertTask(existing?.tasks, id, {
        subject: inputResult.data.subject ?? inputResult.data.title,
        description: inputResult.data.description,
        activeForm: inputResult.data.activeForm,
        status: inputResult.data.status ?? "in_progress",
      }),
      activity,
    );
    return;
  }

  if (toolName === "TaskUpdate") {
    const inputResult = TaskUpdateInputSchema.safeParse(payload.tool_input);
    if (!inputResult.success) {
      deps.appendDebugLog(`TaskUpdate tool_input 格式不符預期: ${inputResult.error.message}`);
      persist(undefined, undefined, activity);
      return;
    }
    const input = inputResult.data;
    const id = input.taskId ?? input.id;
    if (!id) {
      deps.appendDebugLog("TaskUpdate 缺少 taskId，略過這次更新");
      persist(undefined, undefined, activity);
      return;
    }
    const previous = existing?.tasks?.[id];
    persist(
      undefined,
      upsertTask(existing?.tasks, id, {
        status: input.status ?? previous?.status ?? "in_progress",
        subject: input.subject ?? input.title,
        description: input.description,
        owner: input.owner,
        blockedBy: mergeIdLists(previous?.blockedBy, input.addBlockedBy),
        blocks: mergeIdLists(previous?.blocks, input.addBlocks),
      }),
      activity,
    );
    return;
  }

  if (toolName === "TaskList") {
    const list = extractTaskList(payload.tool_response);
    if (!list) {
      deps.appendDebugLog("TaskList tool_response 格式不符預期，略過 resync");
      persist(undefined, undefined, activity);
      return;
    }
    const tasks: Record<string, TaskItem> = {};
    for (const item of list) tasks[item.id] = item;
    persist(undefined, tasks, activity);
    return;
  }

  persist(undefined, undefined, activity);
}
