import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import chokidar from "chokidar";
import { join } from "node:path";
import { STATE_DIR, ensureStateDir, listSessionIds, readTaskState } from "../store.js";
import { TaskState } from "../schema.js";
import { TaskList } from "./TaskList.js";
import { SessionPicker } from "./SessionPicker.js";

export function App({ initialSessionId }: { initialSessionId?: string }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(initialSessionId);
  const [taskState, setTaskState] = useState<TaskState | null>(null);

  // 在非 TTY 環境（例如被其他腳本呼叫、或某些 CI）跳過 raw mode，避免直接噴錯。
  // 注意：isRawModeSupported 在非 TTY 時是 undefined 而非 false，Ink 內部用
  // `=== false` 判斷，所以這裡一定要強制轉成布林值。
  useInput(
    (input) => {
      if (input === "q") exit();
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

  // 若使用者沒指定 session，且目前只有一個，自動選取它
  useEffect(() => {
    if (!selectedSessionId && sessionIds.length === 1) {
      setSelectedSessionId(sessionIds[0]);
    }
  }, [sessionIds, selectedSessionId]);

  // 監控被選中 session 的檔案內容變化
  useEffect(() => {
    if (!selectedSessionId) return;
    setTaskState(readTaskState(selectedSessionId));
    const filePath = join(STATE_DIR, `${selectedSessionId}.json`);
    const watcher = chokidar.watch(filePath, { ignoreInitial: true });
    const refresh = () => setTaskState(readTaskState(selectedSessionId));
    watcher.on("add", refresh).on("change", refresh);
    return () => {
      void watcher.close();
    };
  }, [selectedSessionId]);

  if (!selectedSessionId) {
    if (sessionIds.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>還沒有偵測到任何 task 資料。</Text>
          <Text dimColor>請確認已在此專案執行過「task-tracker init」，且 Claude Code 有 task 在進行中。</Text>
        </Box>
      );
    }
    return <SessionPicker sessionIds={sessionIds} onSelect={setSelectedSessionId} />;
  }

  if (!taskState) {
    return <Text dimColor>讀取 session {selectedSessionId} 資料中…</Text>;
  }

  return <TaskList state={taskState} />;
}
