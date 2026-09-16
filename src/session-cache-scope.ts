/** task-tracker 暫存只存在 ~/.claude-task-tracker，不碰 Claude transcript 或 context window。 */
export const SESSION_CACHE_NOT_CONTEXT_NOTE =
  "此為 task-tracker 暫存（~/.claude-task-tracker），不影響 Claude Code 的 context 或 transcript。";

export const SESSION_CACHE_SCOPE_NOTE = `${SESSION_CACHE_NOT_CONTEXT_NOTE}要縮小 context 請在 Claude Code 用 /clear 或另開 session。`;
