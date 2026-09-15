import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { join } from "node:path";
import { STATE_DIR, ensureStateDir, listSessionIds, readTaskState } from "../store.js";
import { TaskState } from "../schema.js";
import {
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

function withLiveWorkflow(state: TaskState): TaskState {
  const workflow = liveWorkflow(state);
  return workflow ? { ...state, workflow } : state;
}

function hintsFor(sessionIds: string[]): SessionHint[] {
  return sessionIds.flatMap((sessionId) => {
    const state = readTaskState(sessionId);
    if (!state) return [];
    return [{ sessionId: state.sessionId, cwd: state.cwd, updatedAt: state.updatedAt }];
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
      if (input !== "b" && !key.escape) return;
      if (selectedSessionId) {
        setSelectedSessionId(undefined);
        setProjectKey(undefined);
        setTaskState(null);
        setBrowsing(true);
        return;
      }
      if (projectKey) setProjectKey(undefined);
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  // 監控 state 目錄：抓新出現/消失的 session 檔案
  useEffect(() => {
    ensureStateDir();
    setSessionIds(listSessionIds());
    const watcher = chokidar.watch(STATE_DIR, { ignoreInitial: true, depth: 0 });
    const refresh = () => setSessionIds(listSessionIds());
    watcher.on("add", refresh).on("unlink", refresh);
    return () => {
      void watcher.close();
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

  if (!selectedSessionId) {
    if (sessionIds.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>還沒有偵測到任何 session 資料。</Text>
          {(emptyHint ?? [
            "請確認已執行「task-tracker init」，且 Claude Code 正在執行中。",
          ]).map((line) => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      );
    }
    const hints = hintsFor(sessionIds);
    const groups = groupSessionsByProject(hints, cwd);
    if (!projectKey) {
      return (
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
        />
      );
    }
    const group = groups.find((item) => item.key === projectKey);
    return (
      <SessionPicker
        heading={`選擇 session · ${group?.label ?? "專案"}`}
        hint="按 b 回專案列表"
        items={sessionChoicesInProject(group?.sessions ?? [], projectKey, cwd)}
        onSelect={setSelectedSessionId}
      />
    );
  }

  if (!taskState) {
    return <Text dimColor>讀取 session {selectedSessionId} 資料中…</Text>;
  }

  return (
    <TaskList state={taskState} current={sameCwd(taskState.cwd, cwd)} />
  );
}
