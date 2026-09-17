import { isWaitingForUser } from "./session-presence.js";
import { shortSessionId } from "./session-preference.js";

export type AlertKind = "waiting" | "advice";

export interface AlertEvent {
  sessionId: string;
  kind: AlertKind;
  at: string;
  edgeKey: string;
}

export interface JumpTarget {
  sessionId: string;
  kind: AlertKind;
}

export interface AlertSessionSnapshot {
  sessionId: string;
  activity?: { toolName: string; phase: string; at?: string } | null;
  /** 該 session 尚未開過 advice 面板確認的最新 advice.at；無則不算 advice 警報 */
  latestUnreadAdviceAt?: string;
}

export function alertEdgeKey(sessionId: string, kind: AlertKind, at: string): string {
  return `${sessionId}:${kind}:${at}`;
}

function sortAlertEvents(events: AlertEvent[]): AlertEvent[] {
  return [...events].sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind === "waiting") return -1;
      if (right.kind === "waiting") return 1;
    }
    return right.at.localeCompare(left.at);
  });
}

export function collectAlertEvents(input: {
  sessions: AlertSessionSnapshot[];
  selectedSessionId: string | undefined;
}): AlertEvent[] {
  const events: AlertEvent[] = [];
  for (const session of input.sessions) {
    if (session.sessionId === input.selectedSessionId) continue;

    if (isWaitingForUser(session.activity)) {
      const at = session.activity?.at ?? "";
      events.push({
        sessionId: session.sessionId,
        kind: "waiting",
        at,
        edgeKey: alertEdgeKey(session.sessionId, "waiting", at),
      });
    }

    if (session.latestUnreadAdviceAt) {
      const at = session.latestUnreadAdviceAt;
      events.push({
        sessionId: session.sessionId,
        kind: "advice",
        at,
        edgeKey: alertEdgeKey(session.sessionId, "advice", at),
      });
    }
  }
  return sortAlertEvents(events);
}

export function nextJumpTarget(events: AlertEvent[]): JumpTarget | undefined {
  const first = events[0];
  if (!first) return undefined;
  return { sessionId: first.sessionId, kind: first.kind };
}

export function formatAlertBanner(events: AlertEvent[]): string | undefined {
  if (events.length === 0) return undefined;
  const waiting = events.filter((e) => e.kind === "waiting");
  if (waiting.length === 1) {
    return `${shortSessionId(waiting[0]!.sessionId)} 正在等你 · 按 n 跳轉`;
  }
  if (waiting.length > 1) {
    return `${waiting.length} 個 session 在等你 · 按 n 跳轉`;
  }
  const advice = events.filter((e) => e.kind === "advice");
  if (advice.length === 1) {
    return `用量建議 · ${shortSessionId(advice[0]!.sessionId)} · 按 n 查看`;
  }
  if (advice.length > 1) {
    return `有 ${advice.length} 則跨 session 用量建議 · 按 n 查看`;
  }
  return undefined;
}

export function shouldRingAlertBell(
  prevEdge: string | undefined,
  nextEdge: string | undefined,
): boolean {
  if (!nextEdge) return false;
  return prevEdge !== nextEdge;
}
