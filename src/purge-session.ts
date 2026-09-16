import { TaskState } from "./schema.js";
import { Advice } from "./usage/types.js";

export type PurgeIntensity = "light" | "heavy";

export const PURGE_DONE_NOTICE = {
  light: "已輕清建議與已完成任務",
  heavy: "已重清建議與全部任務清單",
} as const;

export function shouldOpenPurgeMenu(
  view: "main" | "advice" | "purge",
  selectedSessionId: string | undefined,
): boolean {
  return view === "main" && selectedSessionId !== undefined;
}

export function withoutSessionAdvice(advice: Advice[], sessionId: string): Advice[] {
  return advice.filter((item) => item.sessionId !== sessionId);
}

function keepActivity(state: TaskState): TaskState["activity"] {
  return state.activity?.phase === "running" ? state.activity : undefined;
}

export function purgeSessionState(
  state: TaskState,
  intensity: PurgeIntensity,
  now: () => string = () => new Date().toISOString(),
): TaskState {
  const activity = keepActivity(state);
  if (intensity === "heavy") {
    return {
      ...state,
      updatedAt: now(),
      activity,
      todos: [],
      tasks: {},
    };
  }
  return {
    ...state,
    updatedAt: now(),
    activity,
    todos: state.todos?.filter((todo) => todo.status !== "completed"),
    tasks: state.tasks
      ? Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => task.status !== "completed"))
      : state.tasks,
  };
}
