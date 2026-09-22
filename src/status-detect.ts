import type { SessionPresence } from "./session-presence.js";
import { classifyPresence, isWaitingForUser } from "./session-presence.js";

export type DetectionTier = "hook" | "pid" | "heuristic";

export interface PresenceResolution {
  presence: SessionPresence;
  tier: DetectionTier;
}

/** 狀態檔在此時間內視為 hook 仍在正常節奏寫入，信任 classifyPresence。 */
export const HOOK_FRESH_THRESHOLD_MS = 10_000;

/** Tier 3：無 pid 時，過期未滿此值視為 busy（須大於 HOOK_FRESH）。 */
export const HEURISTIC_BUSY_MS = 30_000;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ResolvePresenceOptions {
  isPidAlive?: (pid: number) => boolean;
}

function staleMs(updatedAt: string, now: number): number {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return now - t;
}

function heuristicPresence(ageMs: number): SessionPresence {
  if (ageMs < HEURISTIC_BUSY_MS) return "busy";
  return "idle";
}

/**
 * 在既有 classifyPresence 外面包三層 fallback：
 * 1. hook 夠新 → 原樣 classifyPresence
 * 2. 停更但 pid 還活 → idle（「等你」除外：等待期間 hook 本來就不會重寫）
 * 3. 無 pid（或 pid 已死）→ 純時間啟發式
 */
export function resolvePresence(
  state: {
    updatedAt: string;
    pid?: number;
    activity?: { toolName: string; phase: string; at?: string } | null;
  },
  now: number = Date.now(),
  options?: ResolvePresenceOptions,
): PresenceResolution {
  // 等你期間 hook 不會持續寫 updatedAt；必須在 Tier 2/3 之前保住 waiting。
  if (isWaitingForUser(state.activity, now)) {
    return { presence: "waiting", tier: "hook" };
  }

  const age = staleMs(state.updatedAt, now);
  if (age < HOOK_FRESH_THRESHOLD_MS) {
    return {
      presence: classifyPresence({
        activity: state.activity,
        updatedAt: state.updatedAt,
        now,
      }),
      tier: "hook",
    };
  }

  const checkAlive = options?.isPidAlive ?? isPidAlive;
  if (state.pid != null && checkAlive(state.pid)) {
    return { presence: "idle", tier: "pid" };
  }

  return { presence: heuristicPresence(age), tier: "heuristic" };
}
