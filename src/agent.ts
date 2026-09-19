import { z } from "zod";

/** 寫進狀態檔的來源。Claude 不寫這個欄位，缺省即 claude。 */
export const AgentSchema = z.enum(["claude", "codex"]);
export type Agent = z.infer<typeof AgentSchema>;

/** watch 分頁順序。cursor 只保留分頁，尚未接入。 */
export const TAB_AGENTS = ["claude", "codex", "cursor"] as const;
export type TabAgent = (typeof TAB_AGENTS)[number];
export const TAB_LABELS: Record<TabAgent, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
};

export const CODEX_UNSUPPORTED_NOTICE = "Codex session 尚未支援此檢視";

export function agentOf(state: { agent?: Agent } | null | undefined): Agent {
  return state?.agent ?? "claude";
}

/** hook 命令列 `--agent codex`；缺少、缺值或不認得的值一律當作 claude。 */
export function parseAgentArg(argv: readonly string[]): Agent {
  const index = argv.indexOf("--agent");
  const parsed = AgentSchema.safeParse(index >= 0 ? argv[index + 1] : undefined);
  return parsed.success ? parsed.data : "claude";
}
