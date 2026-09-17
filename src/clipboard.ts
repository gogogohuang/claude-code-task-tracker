import { spawnSync } from "node:child_process";

export type ClipboardSpawn = (
  command: string,
  args: string[],
  options?: { input?: string; stdio?: ("pipe" | "ignore")[] },
) => { status: number | null; error?: Error | null };

export interface ClipboardDeps {
  platform: NodeJS.Platform;
  spawn: ClipboardSpawn;
}

const defaultDeps = (): ClipboardDeps => ({
  platform: process.platform,
  spawn: (command, args, options) =>
    spawnSync(command, args, {
      input: options?.input,
      stdio: options?.stdio ?? ["pipe", "ignore", "ignore"],
      encoding: "utf-8",
    }),
});

export function copyText(text: string, deps: ClipboardDeps = defaultDeps()): boolean {
  try {
    if (deps.platform === "darwin") {
      const result = deps.spawn("pbcopy", [], { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return result.status === 0 && !result.error;
    }
    if (deps.platform === "linux") {
      const result = deps.spawn("xclip", ["-selection", "clipboard"], {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
      });
      return result.status === 0 && !result.error;
    }
    return false;
  } catch {
    return false;
  }
}
