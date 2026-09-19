import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { STATE_DIR, ensureStateDir, listSessionIds, readTaskState, statePathForSession } from "../store.js";
import { TaskState } from "../schema.js";
import { agentOf, CODEX_UNSUPPORTED_NOTICE } from "../agent.js";
import {
  addedSessionIds,
  filterListableSessionIds,
  formatNewSessionNotice,
  groupSessionsByProject,
  pickPreferredSession,
  projectChoices,
  sameCwd,
  sessionChoicesInProject,
  shortSessionId,
  shouldAutoSelectSession,
  type SessionHint,
} from "../session-preference.js";
import {
  clearPinOnLeave,
  shouldBlockAutoSelect,
} from "../session-pin.js";
import { liveWorkflow } from "../workflow/paths.js";
import { TaskList } from "./TaskList.js";
import { SplitView, clampSplitScroll } from "./SplitView.js";
import {
  SPLIT_TASK_ROWS,
  SPLIT_TOO_NARROW_NOTICE,
  canEnterSplit,
  canPickSplitPartner,
  focusedSessionId,
  type SplitFocus,
} from "../split-layout.js";
import { taskRows } from "./task-rows.js";
import { SessionPicker } from "./SessionPicker.js";
import { AdvicePanel } from "./AdvicePanel.js";
import { CachePanel } from "./CachePanel.js";
import { ToolsPanel } from "./ToolsPanel.js";
import { HistoryPanel } from "./HistoryPanel.js";
import { cachePanelLinesForSession } from "../cache-panel-lines.js";
import { adviceForSession } from "../usage/advice-groups.js";
import { attachHeavyBaselineHeat } from "../usage/advice-heat.js";
import { forget, peek, peekSubagents, prime, refresh } from "../usage/tail-runtime.js";
import { formatToolInventoryLines, formatToolInventorySummary } from "../usage/tool-inventory.js";
import { resolveTranscriptPath } from "../workflow/paths.js";
import {
  formatContextGaugeBar,
  formatLastTurnBreakdownLine,
  formatOccupiedTokensLine,
  lastTurnUsageFromStats,
} from "../context-snapshot.js";
import {
  isWaitingForUser,
  shouldRingWaitingBell,
  waitingEdgeKey,
  waitingNoticeForActivity,
} from "../session-presence.js";
import { pushActivityToTimeline, type TimelineEntry } from "../activity-timeline.js";
import { formatStuckLabel, isActivityStuck } from "../activity-stuck.js";
import { formatEndedSummary, isSessionEnded } from "../session-ended.js";
import {
  collectAlertEvents,
  formatAlertBanner,
  nextJumpTarget,
  shouldRingAlertBell,
  type AlertSessionSnapshot,
} from "../session-alerts.js";
import {
  isNotifyEnabled,
  notifyAlert,
  shouldSendDesktopNotify,
} from "../desktop-notify.js";
import { discoverInspectModel } from "../inspect/discover.js";
import { heatSummaryLines } from "../inspect/heat.js";
import { defaultManagedPolicyPath } from "../inspect/paths.js";
import {
  DELETE_SESSION_CONFIRM_NOTICE,
  DELETE_SESSION_RUNNING_NOTICE,
  armOrConfirmDelete,
  deleteSessionState,
  isSessionBusy,
  shouldHandleDeleteKey,
  type WatchView,
} from "../delete-session.js";
import { copyText } from "../clipboard.js";
import { Advice } from "../usage/types.js";

function withNotice(notice: string | undefined, child: ReactNode) {
  if (!notice) return child;
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="yellow">⚠ {notice}</Text>
      </Box>
      {child}
    </Box>
  );
}

function withLiveWorkflow(state: TaskState): TaskState {
  const workflow = liveWorkflow(state);
  return workflow ? { ...state, workflow } : state;
}

const MAX_ADVICE = 50;

function formatAdviceNotice(newAdvice: Advice[]): string {
  return newAdvice.length === 1 ? "有新的用量建議 — 按 a 查看" : `有 ${newAdvice.length} 則新的用量建議 — 按 a 查看`;
}

function hintsFor(sessionIds: string[]): SessionHint[] {
  return sessionIds.flatMap((sessionId) => {
    const state = readTaskState(sessionId);
    if (!state) return [];
    const usage = peek(sessionId);
    return [
      {
        sessionId: state.sessionId,
        cwd: state.cwd,
        updatedAt: state.updatedAt,
        activitySummary: state.activity
          ? state.activity.summary
            ? `${state.activity.toolName} · ${state.activity.summary}`
            : state.activity.toolName
          : undefined,
        activityToolName: state.activity?.toolName,
        activityPhase: state.activity?.phase,
        title: usage?.title,
        firstPrompt: usage?.firstPrompt,
      },
    ];
  });
}

function isStateFileForSession(filePath: string, sessionId: string): boolean {
  return basename(filePath) === `${sessionId}.json`;
}

export function App({
  initialSessionId,
  emptyHint,
  watchCwd,
}: {
  initialSessionId?: string;
  emptyHint?: string[];
  watchCwd?: string;
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(initialSessionId);
  const [projectKey, setProjectKey] = useState<string | undefined>();
  const [browsing, setBrowsing] = useState(false);
  const [taskState, setTaskState] = useState<TaskState | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [view, setView] = useState<WatchView>("main");
  const [adviceList, setAdviceList] = useState<Advice[]>([]);
  const adviceWatchers = useRef<Map<string, ReturnType<typeof chokidar.watch>>>(new Map());
  const knownSessionIds = useRef<string[] | null>(null);
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  // transcript refresh 常不產生 advice；這個 revision 讓 peek 驅動的 context 仍能重繪。
  const [usageRevision, setUsageRevision] = useState(0);
  const [clockRevision, setClockRevision] = useState(0);
  // state 檔內容變更時 sessionIds 可能不變；用 revision 強制列表重讀 hints。
  const [stateRevision, setStateRevision] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [pickingSplitPartner, setPickingSplitPartner] = useState(false);
  const [splitLeftId, setSplitLeftId] = useState<string | undefined>();
  const [splitRightId, setSplitRightId] = useState<string | undefined>();
  const [splitFocus, setSplitFocus] = useState<SplitFocus>("left");
  const [splitReturnSessionId, setSplitReturnSessionId] = useState<string | undefined>();
  const [leftScroll, setLeftScroll] = useState(0);
  const [rightScroll, setRightScroll] = useState(0);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | undefined>();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const lastWaitingKey = useRef<string | undefined>(undefined);
  const lastAlertEdgeKey = useRef<string | undefined>(undefined);
  const lastSeenAdviceAtBySession = useRef<Map<string, string>>(new Map());
  const heatCacheRef = useRef<{ cwd: string; lines: string[] } | undefined>(undefined);
  const cwd = watchCwd ?? process.cwd();

  const launchHeatLines = (targetCwd: string): string[] => {
    if (heatCacheRef.current?.cwd === targetCwd) return heatCacheRef.current.lines;
    try {
      const model = discoverInspectModel({
        cwd: targetCwd,
        env: process.env,
        home: homedir(),
        managedPolicyPath: defaultManagedPolicyPath(),
      });
      const lines = heatSummaryLines(model.entries, 5);
      heatCacheRef.current = { cwd: targetCwd, lines };
      return lines;
    } catch {
      heatCacheRef.current = { cwd: targetCwd, lines: [] };
      return [];
    }
  };

  const markAdviceSeen = (sessionId: string) => {
    const latest = adviceList
      .filter((item) => item.sessionId === sessionId)
      .sort((left, right) => right.at.localeCompare(left.at))[0];
    if (latest) lastSeenAdviceAtBySession.current.set(sessionId, latest.at);
  };

  const alertSnapshots = (): AlertSessionSnapshot[] =>
    sessionIds.map((sessionId) => {
      const state = readTaskState(sessionId);
      const latest = adviceList
        .filter((item) => item.sessionId === sessionId)
        .sort((left, right) => right.at.localeCompare(left.at))[0];
      const seen = lastSeenAdviceAtBySession.current.get(sessionId);
      const latestUnreadAdviceAt =
        latest && (!seen || latest.at.localeCompare(seen) > 0) ? latest.at : undefined;
      return {
        sessionId,
        activity: state?.activity,
        latestUnreadAdviceAt,
      };
    });

  const currentAlertEvents = () =>
    collectAlertEvents({ sessions: alertSnapshots(), selectedSessionId });

  const leaveSessionToList = () => {
    setSelectedSessionId(undefined);
    setProjectKey(undefined);
    setTaskState(null);
    setBrowsing(true);
    setNotice(undefined);
    setPendingDeleteSessionId(undefined);
    setView("main");
    lastWaitingKey.current = undefined;
    setTimeline([]);
    setPinned(clearPinOnLeave());
    setPickingSplitPartner(false);
    setSplitLeftId(undefined);
    setSplitRightId(undefined);
    setSplitReturnSessionId(undefined);
    setLeftScroll(0);
    setRightScroll(0);
  };

  const exitSplit = () => {
    const ret = splitReturnSessionId;
    setView("main");
    setSplitLeftId(undefined);
    setSplitRightId(undefined);
    setSplitReturnSessionId(undefined);
    setPickingSplitPartner(false);
    setSelectedSessionId(ret);
    setBrowsing(false);
    setNotice(undefined);
    setPendingDeleteSessionId(undefined);
    setLeftScroll(0);
    setRightScroll(0);
  };

  const actionSessionId =
    view === "split" && splitLeftId && splitRightId
      ? focusedSessionId(splitLeftId, splitRightId, splitFocus)
      : selectedSessionId;

  const beginPickSplitPartner = (leftId: string) => {
    if (!canEnterSplit(process.stdout.columns ?? 0)) {
      setNotice(SPLIT_TOO_NARROW_NOTICE);
      return;
    }
    setSplitReturnSessionId(leftId);
    setPickingSplitPartner(true);
    setSelectedSessionId(undefined);
    setProjectKey(undefined);
    setTaskState(null);
    setBrowsing(true);
    setPendingDeleteSessionId(undefined);
    setNotice("選擇要並排的第二個 session");
  };

  const enterSplitWithPartner = (rightId: string) => {
    if (!splitReturnSessionId) return;
    if (!canPickSplitPartner(rightId, splitReturnSessionId)) {
      setNotice("不能與目前 session 相同");
      return;
    }
    setSplitLeftId(splitReturnSessionId);
    setSplitRightId(rightId);
    setSplitFocus("left");
    setSelectedSessionId(splitReturnSessionId);
    setPickingSplitPartner(false);
    setView("split");
    setBrowsing(false);
    setNotice(undefined);
    setProjectKey(undefined);
  };

  // 在非 TTY 環境（例如被其他腳本呼叫、或某些 CI）跳過 raw mode，避免直接噴錯。
  // 注意：isRawModeSupported 在非 TTY 時是 undefined 而非 false，Ink 內部用
  // `=== false` 判斷，所以這裡一定要強制轉成布林值。
  useInput(
    (input, key) => {
      if (input === "q") {
        exit();
        return;
      }

      if (view === "split") {
        if (input === "[" ) {
          setSplitFocus("left");
          return;
        }
        if (input === "]") {
          setSplitFocus("right");
          return;
        }
        if (input === "v" || input === "b" || key.escape) {
          exitSplit();
          return;
        }
      }

      if (input === "v" && view === "main" && selectedSessionId && !pickingSplitPartner) {
        beginPickSplitPartner(selectedSessionId);
        return;
      }

      const deleteTarget = actionSessionId;
      if (input === "d" && shouldHandleDeleteKey(view, deleteTarget) && deleteTarget) {
        const busyState = view === "split" ? readTaskState(deleteTarget) : taskState;
        if (isSessionBusy(busyState?.activity)) {
          setPendingDeleteSessionId(undefined);
          setNotice(DELETE_SESSION_RUNNING_NOTICE);
          return;
        }
        const step = armOrConfirmDelete(pendingDeleteSessionId, deleteTarget);
        if (step === "arm") {
          setPendingDeleteSessionId(deleteTarget);
          setNotice(DELETE_SESSION_CONFIRM_NOTICE);
          return;
        }
        deleteSessionState(deleteTarget, STATE_DIR);
        const watcher = adviceWatchers.current.get(deleteTarget);
        if (watcher) {
          void watcher.close();
          adviceWatchers.current.delete(deleteTarget);
        }
        forget(deleteTarget);
        setAdviceList((prev) => prev.filter((advice) => advice.sessionId !== deleteTarget));
        if (view === "split") {
          exitSplit();
        } else {
          leaveSessionToList();
        }
        return;
      }
      if (input === "a" && (view === "main" || view === "split") && actionSessionId) {
        setPendingDeleteSessionId(undefined);
        setSelectedSessionId(actionSessionId);
        markAdviceSeen(actionSessionId);
        setView("advice");
        return;
      }
      if (input === "n") {
        const target = nextJumpTarget(currentAlertEvents());
        if (!target) return;
        setPendingDeleteSessionId(undefined);
        setPickingSplitPartner(false);
        setSplitLeftId(undefined);
        setSplitRightId(undefined);
        setSplitReturnSessionId(undefined);
        setSelectedSessionId(target.sessionId);
        setBrowsing(false);
        if (target.kind === "advice") {
          markAdviceSeen(target.sessionId);
          setView("advice");
        } else {
          setView("main");
        }
        return;
      }
      if (input === "s" && (view === "main" || view === "split") && actionSessionId) {
        setPendingDeleteSessionId(undefined);
        setSelectedSessionId(actionSessionId);
        setView("cache");
        return;
      }
      if (input === "t" && (view === "main" || view === "split") && actionSessionId) {
        setPendingDeleteSessionId(undefined);
        setSelectedSessionId(actionSessionId);
        setView("tools");
        return;
      }
      if (input === "h" && (view === "main" || view === "split") && actionSessionId) {
        setPendingDeleteSessionId(undefined);
        setSelectedSessionId(actionSessionId);
        setView("history");
        return;
      }
      if (input === "p" && (view === "main" || view === "split") && actionSessionId) {
        setPendingDeleteSessionId(undefined);
        setSelectedSessionId(actionSessionId);
        setPinned((value) => !value);
        return;
      }
      if ((input === "c" || input === "C") && (view === "main" || view === "split")) {
        if (!actionSessionId) {
          setNotice("沒有可複製的 session");
          return;
        }
        const payload = input === "c" ? actionSessionId : statePathForSession(actionSessionId);
        const ok = copyText(payload);
        setNotice(ok ? (input === "c" ? "已複製 session id" : "已複製暫存路徑") : "複製失敗（請手動選取）");
        return;
      }
      if (input !== "b" && !key.escape) return;
      setPendingDeleteSessionId(undefined);
      if (pickingSplitPartner) {
        setPickingSplitPartner(false);
        setSelectedSessionId(splitReturnSessionId);
        setBrowsing(false);
        setNotice(undefined);
        return;
      }
      if (view === "advice" || view === "cache" || view === "tools" || view === "history") {
        if (splitLeftId && splitRightId) {
          setView("split");
          setSelectedSessionId(focusedSessionId(splitLeftId, splitRightId, splitFocus));
        } else {
          setView("main");
        }
        setNotice(undefined);
        return;
      }
      if (selectedSessionId) {
        leaveSessionToList();
        return;
      }
      if (projectKey) setProjectKey(undefined);
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  // 監控 state 目錄：抓新出現/消失的 session 檔案。第一次列出的當基線，之後才通知。
  // 無 cwd 的狀態檔不進可見池（不進列表、不響新 session 鈴、不掛跨 session 警示）。
  useEffect(() => {
    const apply = (next: string[], initial: boolean) => {
      const listable = filterListableSessionIds(next, (sessionId) => readTaskState(sessionId)?.cwd);
      if (!initial && knownSessionIds.current) {
        const added = addedSessionIds(knownSessionIds.current, listable);
        if (added.length > 0) {
          const hints = hintsFor(added);
          setNotice(formatNewSessionNotice(hints.length > 0 ? hints : added.map((sessionId) => ({ sessionId }))));
          try {
            process.stdout.write("\x07");
          } catch {
            // 終端機不支援鈴就略過
          }
        }
      }
      knownSessionIds.current = listable;
      setSessionIds(listable);
      if (!initial) setStateRevision((n) => n + 1);
    };
    ensureStateDir();
    apply(listSessionIds(), true);
    const watcher = chokidar.watch(STATE_DIR, { ignoreInitial: true, depth: 0 });
    const refresh = () => apply(listSessionIds(), false);
    // 也要聽 change：某個既有 session 的 state 檔內容變了（例如稍後才補上 claudeSessionDir），
    // 即使 sessionIds 的值沒變，重新拿一份新陣列還是會讓下面依賴 sessionIds 的 effect 重新跑一次，
    // 讓原本沒有 claudeSessionDir、掛不上 watcher 的 session 有機會補掛上去。
    // 同樣：舊檔稍後寫入 cwd 時會從不可見變成可見。
    watcher.on("add", refresh).on("unlink", refresh).on("change", refresh);
    return () => {
      void watcher.close();
    };
  }, []);

  // 對每個已知 session 的 transcript 檔案掛用量分析（不限正在看的那個），
  // 只在 sessionId 第一次出現時 prime，session 消失時才 forget + 關 watcher。
  useEffect(() => {
    const watchers = adviceWatchers.current;
    const current = new Set(sessionIds);

    const applyAdvice = (newAdvice: Advice[]) => {
      setUsageRevision((revision) => revision + 1);
      if (newAdvice.length === 0) return;
      // adviceList 維持「舊到新」排列，蓋過上限時從尾端（新的那端）保留最新 MAX_ADVICE 則；
      // 之前是 prepend 後從頭 slice，一批 advice 超過上限時反而留下該批裡最舊的那些。
      setAdviceList((prev) => [...prev, ...newAdvice].slice(-MAX_ADVICE));
      const selected = selectedSessionIdRef.current;
      const relevant = selected ? newAdvice.filter((item) => item.sessionId === selected) : [];
      if (relevant.length === 0) return;
      setNotice(formatAdviceNotice(relevant));
      try {
        process.stdout.write("\x07");
      } catch {
        // 終端機不支援鈴就略過
      }
    };

    for (const sessionId of sessionIds) {
      if (watchers.has(sessionId)) continue;
      const state = readTaskState(sessionId);
      if (!state?.claudeSessionDir) continue;
      const transcriptPath = resolveTranscriptPath(state.claudeSessionDir, sessionId);

      try {
        applyAdvice(prime(sessionId, transcriptPath).advice);
      } catch {
        // 用量分析出任何錯誤都不能拖垮主畫面
      }

      const watcher = chokidar.watch(transcriptPath, { ignoreInitial: true, ignorePermissionErrors: true });
      const onTranscriptEvent = () => {
        try {
          applyAdvice(refresh(sessionId, transcriptPath));
        } catch {
          // 同上
        }
      };
      // transcript 檔案掛 watcher 時可能還沒被 Claude Code 建立（session state 檔通常先寫）；
      // 跟下面 workflow/journal watcher 用同一個慣例，add／change 都接同一個 handler。
      // chokidar 的 error 事件若沒人聽，會直接丟出未捕捉例外，把整個 TUI 弄掛；
      // 用量分析本來就設計成任何錯誤都不能拖垮主畫面，這裡補上 no-op listener。
      watcher.on("add", onTranscriptEvent).on("change", onTranscriptEvent).on("error", () => {});
      watchers.set(sessionId, watcher);
    }

    for (const [sessionId, watcher] of [...watchers.entries()]) {
      if (current.has(sessionId)) continue;
      void watcher.close();
      watchers.delete(sessionId);
      forget(sessionId);
      // session 消失後它的 advice 也要一併清掉，不然會一直卡在 adviceList 的上限額度裡。
      setAdviceList((prev) => prev.filter((advice) => advice.sessionId !== sessionId));
    }
  }, [sessionIds]);

  useEffect(() => {
    return () => {
      for (const watcher of adviceWatchers.current.values()) void watcher.close();
      adviceWatchers.current.clear();
    };
  }, []);

  // 沒指定 session 時：cwd 對得上就自動選當下專案；只有一個也直接選。
  // 使用者按 b 回到列表後不再自動跳回去。
  useEffect(() => {
    if (browsing || selectedSessionId || sessionIds.length === 0) return;
    if (pickingSplitPartner) return;
    if (shouldBlockAutoSelect(pinned)) return;
    const hints = hintsFor(sessionIds);
    if (!shouldAutoSelectSession(hints, cwd)) return;
    const preferred = pickPreferredSession(hints, cwd);
    if (preferred) setSelectedSessionId(preferred);
  }, [sessionIds, selectedSessionId, cwd, browsing, pinned, pickingSplitPartner]);

  // 監控被選中 session 的檔案內容變化。
  // 寫入是 write-then-rename：直接 watch 最終路徑常會在 inode 換掉後漏事件，
  // 改 watch STATE_DIR 再依 basename 過濾，並聽 unlink（rename 替換時常見）。
  useEffect(() => {
    if (!selectedSessionId) return;
    const refresh = () => {
      const latest = readTaskState(selectedSessionId);
      setTaskState(latest ? withLiveWorkflow(latest) : null);
    };
    refresh();
    const watcher = chokidar.watch(STATE_DIR, { ignoreInitial: true, depth: 0 });
    const onFsEvent = (filePath: string) => {
      if (isStateFileForSession(filePath, selectedSessionId)) refresh();
    };
    watcher.on("add", onFsEvent).on("change", onFsEvent).on("unlink", onFsEvent);
    return () => {
      void watcher.close();
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const journalPath = taskState?.workflow?.journalPath;
    const workflowsDir = taskState?.claudeSessionDir
      ? join(taskState.claudeSessionDir, "subagents", "workflows")
      : undefined;
    const targets = [journalPath, workflowsDir].filter((path): path is string => Boolean(path));
    if (targets.length === 0) return;
    const watcher = chokidar.watch(targets, { ignoreInitial: true, ignorePermissionErrors: true });
    const refresh = () => {
      const latest = readTaskState(selectedSessionId);
      if (latest) setTaskState(withLiveWorkflow(latest));
    };
    watcher.on("add", refresh).on("change", refresh);
    return () => {
      void watcher.close();
    };
  }, [selectedSessionId, taskState?.workflow?.journalPath, taskState?.claudeSessionDir]);

  useEffect(() => {
    if (!selectedSessionId || !taskState?.activity || !isWaitingForUser(taskState.activity)) {
      if (!isWaitingForUser(taskState?.activity)) {
        lastWaitingKey.current = undefined;
      }
      return;
    }
    const nextKey = waitingEdgeKey(selectedSessionId, {
      toolName: taskState.activity.toolName,
      at: taskState.activity.at,
    });
    if (shouldRingWaitingBell(lastWaitingKey.current, nextKey)) {
      try {
        process.stdout.write("\x07");
      } catch {
        // 終端機不支援鈴就略過
      }
    }
    lastWaitingKey.current = nextKey;
  }, [selectedSessionId, taskState?.activity?.toolName, taskState?.activity?.phase, taskState?.activity?.at]);

  useEffect(() => {
    const events = currentAlertEvents();
    const nextEdge = events[0]?.edgeKey;
    const ring = shouldRingAlertBell(lastAlertEdgeKey.current, nextEdge);
    if (ring) {
      try {
        process.stdout.write("\x07");
      } catch {
        // 終端機不支援鈴就略過
      }
    }
    const enabled = isNotifyEnabled(process.env);
    if (shouldSendDesktopNotify(lastAlertEdgeKey.current, nextEdge, enabled) && events[0]) {
      const first = events[0];
      const state = readTaskState(first.sessionId);
      notifyAlert({
        sessionId: first.sessionId,
        kind: first.kind,
        shortId: shortSessionId(first.sessionId),
        projectLabel: state?.cwd ? basename(state.cwd) : undefined,
      });
    }
    lastAlertEdgeKey.current = nextEdge;
  }, [sessionIds, selectedSessionId, adviceList, stateRevision, taskState?.updatedAt]);

  useEffect(() => {
    setTimeline([]);
  }, [selectedSessionId]);

  useEffect(() => {
    const activity = taskState?.activity;
    if (!selectedSessionId || !activity) return;
    setTimeline((prev) =>
      pushActivityToTimeline(prev, {
        at: activity.at,
        toolName: activity.toolName,
        phase: activity.phase,
        summary: activity.summary,
      }),
    );
  }, [selectedSessionId, taskState?.activity?.at, taskState?.activity?.phase, taskState?.activity?.toolName, taskState?.activity?.summary]);

  useEffect(() => {
    if (!selectedSessionId || taskState?.activity?.phase !== "running") return;
    if (isWaitingForUser(taskState.activity)) return;
    const timer = setInterval(() => setClockRevision((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [selectedSessionId, taskState?.activity?.phase, taskState?.activity?.toolName, taskState?.activity?.at]);

  useEffect(() => {
    // 列表與 session 內都要讓 presence 隨時間老化（waiting → idle）
    const timer = setInterval(() => setClockRevision((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const actionActivity = actionSessionId
    ? view === "split"
      ? readTaskState(actionSessionId)?.activity
      : taskState?.activity
    : undefined;
  const waitingNotice = waitingNoticeForActivity(actionActivity);
  const alertBanner = formatAlertBanner(currentAlertEvents());
  const topNotice = waitingNotice ?? alertBanner ?? notice;

  if (view === "split" && splitLeftId && splitRightId) {
    void stateRevision;
    void clockRevision;
    const leftState = readTaskState(splitLeftId);
    const rightState = readTaskState(splitRightId);
    const leftUsage = peek(splitLeftId);
    const rightUsage = peek(splitRightId);
    return withNotice(
      topNotice,
      <SplitView
        left={leftState}
        right={rightState}
        focus={splitFocus}
        pinned={pinned}
        leftGauge={formatContextGaugeBar(leftUsage?.lastOccupiedTokens)}
        rightGauge={formatContextGaugeBar(rightUsage?.lastOccupiedTokens)}
        leftScroll={leftScroll}
        rightScroll={rightScroll}
        onScrollFocus={(delta) => {
          const id = focusedSessionId(splitLeftId, splitRightId, splitFocus);
          const rows = taskRows(readTaskState(id) ?? { sessionId: id, updatedAt: "" });
          if (splitFocus === "left") {
            setLeftScroll((n) => clampSplitScroll(n + delta, rows.length, SPLIT_TASK_ROWS));
          } else {
            setRightScroll((n) => clampSplitScroll(n + delta, rows.length, SPLIT_TASK_ROWS));
          }
        }}
      />,
    );
  }

  if (view === "advice") {
    const filtered = adviceForSession(adviceList, selectedSessionId);
    const heatCwd =
      (selectedSessionId ? readTaskState(selectedSessionId)?.cwd : undefined) ??
      taskState?.cwd ??
      cwd;
    const enriched =
      filtered.some((item) => item.kind === "heavy-baseline")
        ? attachHeavyBaselineHeat(filtered, launchHeatLines(heatCwd))
        : filtered;
    const shortId = selectedSessionId ? shortSessionId(selectedSessionId) : undefined;
    const emptyHint = selectedSessionId ? undefined : "先選一個 session 再查看用量建議";
    const uncoveredHint =
      selectedSessionId && agentOf(readTaskState(selectedSessionId)) === "codex"
        ? CODEX_UNSUPPORTED_NOTICE
        : selectedSessionId && !readTaskState(selectedSessionId)?.claudeSessionDir
          ? "這個 session 還沒有 transcript 路徑，尚未納入分析"
          : undefined;
    return withNotice(
      topNotice,
      <AdvicePanel
        advice={enriched}
        shortId={shortId}
        emptyHint={emptyHint}
        uncoveredHint={uncoveredHint}
      />,
    );
  }

  if (view === "cache" && selectedSessionId) {
    const shortId = shortSessionId(selectedSessionId);
    const latest = readTaskState(selectedSessionId) ?? taskState;
    const lines =
      agentOf(latest) === "codex"
        ? [CODEX_UNSUPPORTED_NOTICE]
        : cachePanelLinesForSession(selectedSessionId, statePathForSession(selectedSessionId), latest);
    return withNotice(topNotice, <CachePanel lines={lines} shortId={shortId} />);
  }

  if (view === "tools" && selectedSessionId) {
    const shortId = shortSessionId(selectedSessionId);
    const inventory = peek(selectedSessionId)?.toolInventory;
    const lines = inventory ? formatToolInventoryLines(inventory) : [];
    const uncoveredHint =
      agentOf(readTaskState(selectedSessionId)) === "codex"
        ? CODEX_UNSUPPORTED_NOTICE
        : !readTaskState(selectedSessionId)?.claudeSessionDir
          ? "這個 session 還沒有 transcript 路徑，尚未納入分析"
          : undefined;
    return withNotice(
      topNotice,
      <ToolsPanel lines={lines} shortId={shortId} emptyHint={uncoveredHint} />,
    );
  }

  if (view === "history" && selectedSessionId) {
    return withNotice(
      topNotice,
      <HistoryPanel entries={timeline} shortId={shortSessionId(selectedSessionId)} />,
    );
  }

  if (!selectedSessionId) {
    if (sessionIds.length === 0) {
      return withNotice(
        notice,
        <Box flexDirection="column">
          <Text dimColor>還沒有偵測到任何 session 資料。</Text>
          {(emptyHint ?? [
            "請確認已執行「task-tracker init」，且 Claude Code 正在執行中。",
          ]).map((line) => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>,
      );
    }
    const hints = hintsFor(sessionIds);
    void stateRevision;
    const groups = groupSessionsByProject(hints, cwd);
    if (groups.length === 0) {
      return withNotice(
        notice,
        <Box flexDirection="column">
          <Text dimColor>還沒有偵測到任何 session 資料。</Text>
          {(emptyHint ?? [
            "請確認已執行「task-tracker init」，且 Claude Code 正在執行中。",
          ]).map((line) => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>,
      );
    }
    if (!projectKey) {
      return withNotice(
        notice,
        <SessionPicker
          heading={pickingSplitPartner ? "選擇並排 session 的專案" : "選擇專案"}
          hint={pickingSplitPartner ? "按 b 取消分割" : "按 q 離開"}
          items={projectChoices(hints, cwd)}
          onSelect={(key) => {
            const group = groups.find((item) => item.key === key);
            const preferred = group ? pickPreferredSession(group.sessions, cwd) : undefined;
            if (group && group.sessions.length === 1 && preferred) {
              if (pickingSplitPartner) {
                enterSplitWithPartner(preferred);
                return;
              }
              setSelectedSessionId(preferred);
              return;
            }
            setProjectKey(key);
          }}
        />,
      );
    }
    const group = groups.find((item) => item.key === projectKey);
    return withNotice(
      topNotice,
      <SessionPicker
        heading={
          pickingSplitPartner
            ? `選擇並排 session · ${group?.label ?? "專案"}`
            : `選擇 session · ${group?.label ?? "專案"}`
        }
        hint={pickingSplitPartner ? "按 b 取消分割" : "按 b 回專案列表"}
        items={sessionChoicesInProject(group?.sessions ?? [], projectKey, cwd)}
        onSelect={(id) => {
          if (pickingSplitPartner) {
            enterSplitWithPartner(id);
            return;
          }
          setSelectedSessionId(id);
        }}
      />,
    );
  }

  if (!taskState) {
    return withNotice(topNotice, <Text dimColor>讀取 session {selectedSessionId} 資料中…</Text>);
  }

  void usageRevision; // transcript 推進時 bump，確保 peek 後的 context 會重繪
  void clockRevision; // running 時每秒 bump，重算卡住標籤
  void stateRevision;
  const usage = peek(taskState.sessionId);
  const lastTurn = lastTurnUsageFromStats(usage);
  const contextSnapshot = {
    occupiedLine: formatOccupiedTokensLine(usage?.lastOccupiedTokens),
    breakdownLine: formatLastTurnBreakdownLine(lastTurn),
    gauge: formatContextGaugeBar(usage?.lastOccupiedTokens),
  };
  const toolInventorySummary = usage?.toolInventory
    ? formatToolInventorySummary(usage.toolInventory)
    : undefined;
  const stuckLabel =
    taskState.activity && isActivityStuck({ activity: taskState.activity })
      ? formatStuckLabel(taskState.activity.at)
      : undefined;
  const endedSummary = isSessionEnded(taskState)
    ? formatEndedSummary(taskState)
    : undefined;

  return withNotice(
    topNotice,
    <TaskList
      state={taskState}
      current={sameCwd(taskState.cwd, cwd)}
      contextSnapshot={contextSnapshot}
      toolInventorySummary={toolInventorySummary}
      stuckLabel={stuckLabel}
      endedSummary={endedSummary}
      pinned={pinned}
      subagents={peekSubagents(taskState.sessionId)}
    />,
  );
}
