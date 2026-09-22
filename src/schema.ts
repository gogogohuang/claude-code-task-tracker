import { z } from "zod";
import { AgentSchema } from "./agent.js";

/**
 * Claude Code TodoWrite 工具的單一 task 結構。
 * 官方欄位：content（祈使句，如「修正 bug」）、
 * activeForm（現在進行式，如「正在修正 bug」）、status。
 */
export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoItemSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  status: TodoStatusSchema,
  activeForm: z.string().optional(),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

/**
 * TodoWrite 工具呼叫時的 tool_input 結構。
 * `merge: true` 時依 id（沒有 id 則用 content）更新，不整包覆寫。
 */
export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema),
  merge: z.boolean().optional(),
});

/**
 * 新版 Task 系列工具（TaskCreate / TaskUpdate / TaskList）的單一 task 結構。
 *
 * ⚠️ 這組工具的欄位名稱沒有公開的官方 schema 文件可查（官方 hooks 文件只
 * 證實 TaskCreate 對應 TaskCreated hook event，沒有給 tool_input/tool_response
 * 細節），這裡是依非官方文件整理的最佳猜測。所有欄位除了 id/status 都設成
 * optional，實際串接後請對照 `~/.claude-task-tracker/hook-debug.log`
 * 或當下版本的 hooks 文件再次確認。
 */
export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "deleted"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskItemSchema = z.object({
  id: z.string(),
  subject: z.string().optional(),
  description: z.string().optional(),
  status: TaskStatusSchema,
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

/** TaskCreate 工具呼叫時的 tool_input 結構（猜測，無法從 input 拿到產生的 taskId）。 */
export const TaskCreateInputSchema = z.object({
  subject: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  status: TaskStatusSchema.optional(),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

/** TaskUpdate 工具呼叫時的 tool_input 結構（猜測；id 是 taskId 的別名）。 */
export const TaskUpdateInputSchema = z.object({
  taskId: z.string().optional(),
  id: z.string().optional(),
  status: TaskStatusSchema.optional(),
  subject: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  owner: z.string().optional(),
  addBlockedBy: z.array(z.string()).optional(),
  addBlocks: z.array(z.string()).optional(),
});
export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;

/**
 * Claude Code PostToolUse hook 從 stdin 傳進來的 JSON payload。
 *
 * ⚠️ 這個結構是依官方 hooks 文件整理，但 Claude Code 版本更新可能調整欄位，
 * 所以除了必要欄位都設成 optional，並用 .passthrough() 保留未知欄位，
 * 避免版本升級後直接解析失敗。實際串接前建議對照當下版本的
 * https://docs.claude.com/en/docs/claude-code/hooks 再次確認欄位名稱。
 *
 * tool_response 是為了支援 TaskCreate（拿新產生的 taskId）跟 TaskList
 * （拿完整清單做 resync）才加的，同樣是 optional + unknown，parse 失敗
 * 就當作沒有這個欄位處理。
 */
export const HookPayloadSchema = z
  .object({
    session_id: z.string(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
    source: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_response: z.unknown().optional(),
    task_id: z.string().optional(),
    task_subject: z.string().optional(),
    task_description: z.string().optional(),
    teammate_name: z.string().optional(),
  })
  .passthrough();
export type HookPayload = z.infer<typeof HookPayloadSchema>;

/**
 * 不管有沒有開 TodoWrite/Task 清單，session 呼叫任何工具時都會更新的
 * 「目前活動」快照。PreToolUse 寫 running，PostToolUse 寫 done，讓沒有
 * task 清單可看時，畫面上至少還有「目前在做什麼」可看。
 */
export const ActivityPhaseSchema = z.enum(["running", "done"]);
export type ActivityPhase = z.infer<typeof ActivityPhaseSchema>;

export const ActivitySchema = z.object({
  toolName: z.string(),
  phase: ActivityPhaseSchema,
  /** 可閱讀的活動句，例如「正在讀取 src/schema.ts」。不存原始指令或檔案內容。 */
  summary: z.string().optional(),
  at: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const WorkflowStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  summary: z.string().optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowPhaseSchema = z.object({
  title: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  steps: z.array(WorkflowStepSchema).optional(),
});
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowRunSchema = z.object({
  runId: z.string(),
  name: z.string().optional(),
  journalPath: z.string(),
  phases: z.array(WorkflowPhaseSchema),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

/**
 * 我們自己寫到磁碟的狀態檔案格式（task-tracker 的內部格式，穩定不受
 * Claude Code 版本影響）。
 *
 * `todos` 是舊版 TodoWrite 的資料（整包覆寫）；`tasks` 是新版 Task 系列
 * 工具的資料，用 id 當 key 累積 create/update，兩者互不影響、可以共存。
 * `activity` 是不論哪個工具都會更新的「目前活動」快照。
 * `workflow` 是 Claude Code dynamic workflow 的 phase 清單；即時狀態由
 * watch 讀 journal，不靠每次 hook 覆寫。
 */
export const TaskStateSchema = z.object({
  sessionId: z.string(),
  cwd: z.string().optional(),
  /** 狀態來源。只有 Codex 寫入 "codex"；缺省視為 claude（舊檔不需遷移）。 */
  agent: AgentSchema.optional(),
  claudeSessionDir: z.string().optional(),
  /** Codex 的 rollout 檔路徑（hook payload 的 transcript_path）。只有 Codex 寫入；用量分析靠它 tail。 */
  transcriptPath: z.string().optional(),
  /**
   * Claude Code／Codex 本體的 pid。SessionStart hook 寫入 `process.ppid`
   *（hook 是被 spawn 的子行程）。給 status-detect Tier 2 判斷行程是否還活著。
   */
  pid: z.number().optional(),
  updatedAt: z.string(),
  todos: z.array(TodoItemSchema).optional(),
  tasks: z.record(z.string(), TaskItemSchema).optional(),
  activity: ActivitySchema.optional(),
  workflow: WorkflowRunSchema.optional(),
});
export type TaskState = z.infer<typeof TaskStateSchema>;
