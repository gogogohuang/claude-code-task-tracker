import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { join } from "node:path";
import { STATE_DIR, ensureStateDir, listSessionIds, readTaskState } from "../store.js";
import { TaskState } from "../schema.js";
import {
  addedSessionIds,
  formatNewSessionNotice,
  groupSessionsByProject,
  pickPreferredSession,
  projectChoices,
  sameCwd,
  sessionChoicesInProject,
  shouldAutoSelectSession,
  type SessionHint,
} from "../session-preference.js";
import { liveWorkflow } from "../workflow/paths.js";
import { TaskList } from "./TaskList.js";
import { SessionPicker } from "./SessionPicker.js";
import { AdvicePanel } from "./AdvicePanel.js";
import { groupAdviceByProject } from "../usage/advice-groups.js";
import { forget, prime, refresh } from "../usage/tail-runtime.js";
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
    return [
      {
        sessionId: state.sessionId,
        cwd: state.cwd,
        updatedAt: state.updatedAt,
        activitySummary: state.activity?.summary,
      },
    ];
  });
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
  const [view, setView] = useState<"main" | "advice">("main");
  const [adviceList, setAdviceList] = useState<Advice[]>([]);
  const adviceWatchers = useRef<Map<string, ReturnType<typeof chokidar.watch>>>(new Map());
  const knownSessionIds = useRef<string[] | null>(null);
  const cwd = watchCwd ?? process.cwd();

  // 在非 TTY 環境（例如被其他腳本呼叫、或某些 CI）跳過 raw mode，避免直接噴錯。
  // 注意：isRawModeSupported 在非 TTY 時是 undefined 而非 false，Ink 內部用
  // `=== false` 判斷，所以這裡一定要強制轉成布林值。
  useInput(
    (input, key) => {
      if (input === "q") {
        exit();
        return;
      }
      if (input === "a" && view === "main") {
        setView("advice");
        return;
      }
      if (input !== "b" && !key.escape) return;
      if (view === "advice") {
        setView("main");
        setNotice(undefined);
        return;
      }
      if (selectedSessionId) {
        setSelectedSessionId(undefined);
        setProjectKey(undefined);
        setTaskState(null);
        setBrowsing(true);
        setNotice(undefined);
        return;
      }
      if (projectKey) setProjectKey(undefined);
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  // 監控 state 目錄：抓新出現/消失的 session 檔案。第一次列出的當基線，之後才通知。
  useEffect(() => {
    const apply = (next: string[], initial: boolean) => {
      if (!initial && knownSessionIds.current) {
        const added = addedSessionIds(knownSessionIds.current, next);
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
      knownSessionIds.current = next;
      setSessionIds(next);
    };
    ensureStateDir();
    apply(listSessionIds(), true);
    const watcher = chokidar.watch(STATE_DIR, { ignoreInitial: true, depth: 0 });
    const refresh = () => apply(listSessionIds(), false);
    // 也要聽 change：某個既有 session 的 state 檔內容變了（例如稍後才補上 claudeSessionDir），
    // 即使 sessionIds 的值沒變，重新拿一份新陣列還是會讓下面依賴 sessionIds 的 effect 重新跑一次，
    // 讓原本沒有 claudeSessionDir、掛不上 watcher 的 session 有機會補掛上去。
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
      if (newAdvice.length === 0) return;
      // adviceList 維持「舊到新」排列，蓋過上限時從尾端（新的那端）保留最新 MAX_ADVICE 則；
      // 之前是 prepend 後從頭 slice，一批 advice 超過上限時反而留下該批裡最舊的那些。
      setAdviceList((prev) => [...prev, ...newAdvice].slice(-MAX_ADVICE));
      setNotice(formatAdviceNotice(newAdvice));
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
      const transcriptPath = join(state.claudeSessionDir, `${sessionId}.jsonl`);

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
      // session 消失後它的 advice 也要一併清掉，不然會一直卡在 adviceList 的上限額度裡，
      // 但 groupAdviceByProject 又把它濾掉不顯示，造成「鈴響了但面板說沒有建議」的落差。
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
    const hints = hintsFor(sessionIds);
    if (!shouldAutoSelectSession(hints, cwd)) return;
    const preferred = pickPreferredSession(hints, cwd);
    if (preferred) setSelectedSessionId(preferred);
  }, [sessionIds, selectedSessionId, cwd, browsing]);

  // 監控被選中 session 的檔案內容變化
  useEffect(() => {
    if (!selectedSessionId) return;
    const refresh = () => {
      const latest = readTaskState(selectedSessionId);
      setTaskState(latest ? withLiveWorkflow(latest) : null);
    };
    refresh();
    const filePath = join(STATE_DIR, `${selectedSessionId}.json`);
    const watcher = chokidar.watch(filePath, { ignoreInitial: true });
    watcher.on("add", refresh).on("change", refresh);
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

  if (view === "advice") {
    const groups = groupAdviceByProject(adviceList, hintsFor(sessionIds), cwd);
    const uncoveredCount = sessionIds.filter((sessionId) => !readTaskState(sessionId)?.claudeSessionDir).length;
    return withNotice(notice, <AdvicePanel groups={groups} uncoveredCount={uncoveredCount} />);
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
    const groups = groupSessionsByProject(hints, cwd);
    if (!projectKey) {
      return withNotice(
        notice,
        <SessionPicker
          heading="選擇專案"
          hint="按 q 離開"
          items={projectChoices(hints, cwd)}
          onSelect={(key) => {
            const group = groups.find((item) => item.key === key);
            const preferred = group ? pickPreferredSession(group.sessions, cwd) : undefined;
            if (group && group.sessions.length === 1 && preferred) {
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
      notice,
      <SessionPicker
        heading={`選擇 session · ${group?.label ?? "專案"}`}
        hint="按 b 回專案列表"
        items={sessionChoicesInProject(group?.sessions ?? [], projectKey, cwd)}
        onSelect={setSelectedSessionId}
      />,
    );
  }

  if (!taskState) {
    return withNotice(notice, <Text dimColor>讀取 session {selectedSessionId} 資料中…</Text>);
  }

  return withNotice(
    notice,
    <TaskList state={taskState} current={sameCwd(taskState.cwd, cwd)} />,
  );
}
