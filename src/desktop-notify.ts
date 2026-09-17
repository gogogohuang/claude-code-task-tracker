import { spawnSync } from "node:child_process";

export type NotifyKind = "waiting" | "advice";

export interface NotifyAlertInput {
  sessionId: string;
  kind: NotifyKind;
  shortId: string;
  projectLabel?: string;
}

export type NotifySpawn = (command: string, args: string[], options?: { stdio?: "ignore" }) => unknown;

export interface NotifyDeps {
  enabled: boolean;
  platform: NodeJS.Platform;
  spawn: NotifySpawn;
}

const defaultDeps = (): NotifyDeps => ({
  enabled: isNotifyEnabled(process.env),
  platform: process.platform,
  spawn: (command, args, options) => spawnSync(command, args, options),
});

export function isNotifyEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.TASK_TRACKER_NOTIFY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function shouldSendDesktopNotify(
  prevEdge: string | undefined,
  nextEdge: string | undefined,
  enabled: boolean,
): boolean {
  if (!enabled || !nextEdge) return false;
  return prevEdge !== nextEdge;
}

function notificationCopy(input: NotifyAlertInput): { title: string; body: string } {
  const where = input.projectLabel ?? input.shortId;
  if (input.kind === "waiting") {
    return { title: "task-tracker", body: `${where} 正在等你` };
  }
  return { title: "task-tracker", body: `${where} 有新的用量建議` };
}

export function notifyAlert(input: NotifyAlertInput, deps: NotifyDeps = defaultDeps()): void {
  if (!deps.enabled || deps.platform !== "darwin") return;
  const { title, body } = notificationCopy(input);
  const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
  try {
    deps.spawn("osascript", ["-e", script], { stdio: "ignore" });
  } catch {
    // 静默
  }
}
