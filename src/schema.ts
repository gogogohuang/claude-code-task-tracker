import { z } from "zod";

/**
 * Claude Code TodoWrite 工具的單一 task 結構。
 * 官方欄位：content（祈使句，如「修正 bug」）、
 * activeForm（現在進行式，如「正在修正 bug」）、status。
 */
export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoItemSchema = z.object({
  content: z.string(),
  status: TodoStatusSchema,
  activeForm: z.string().optional(),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

/**
 * TodoWrite 工具呼叫時的 tool_input 結構。
 */
export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema),
});

/**
 * Claude Code PostToolUse hook 從 stdin 傳進來的 JSON payload。
 *
 * ⚠️ 這個結構是依官方 hooks 文件整理，但 Claude Code 版本更新可能調整欄位，
 * 所以除了必要欄位都設成 optional，並用 .passthrough() 保留未知欄位，
 * 避免版本升級後直接解析失敗。實際串接前建議對照當下版本的
 * https://docs.claude.com/en/docs/claude-code/hooks 再次確認欄位名稱。
 */
export const HookPayloadSchema = z
  .object({
    session_id: z.string(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();
export type HookPayload = z.infer<typeof HookPayloadSchema>;

/**
 * 我們自己寫到磁碟的狀態檔案格式（task-tracker 的內部格式，穩定不受
 * Claude Code 版本影響）。
 */
export const TaskStateSchema = z.object({
  sessionId: z.string(),
  cwd: z.string().optional(),
  updatedAt: z.string(),
  todos: z.array(TodoItemSchema),
});
export type TaskState = z.infer<typeof TaskStateSchema>;
