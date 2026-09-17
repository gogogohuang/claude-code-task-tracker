export type WorkflowPhaseStatus = "pending" | "in_progress" | "completed";

export interface WorkflowStep {
  key: string;
  label: string;
  status: WorkflowPhaseStatus;
  summary?: string;
}

export interface WorkflowPhase {
  title: string;
  status: WorkflowPhaseStatus;
  steps?: WorkflowStep[];
}

export interface JournalEvent {
  type: "started" | "result";
  key: string;
  phase: string;
  label?: string;
  result?: unknown;
}

const SUMMARY_LIMIT = 48;

export function summarizeJournalResult(result: unknown, limit: number = SUMMARY_LIMIT): string | undefined {
  if (result == null) return undefined;
  let text: string | undefined;
  if (typeof result === "string") {
    text = result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } else if (typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    for (const key of ["summary", "error", "status", "branch", "planFile"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        text = value.trim();
        break;
      }
    }
  }
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function parseJournalEvents(raw: string): JournalEvent[] {
  const events: JournalEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if ((parsed.type !== "started" && parsed.type !== "result") || typeof parsed.key !== "string") continue;
      const phase = typeof parsed.phase === "string" ? parsed.phase : "";
      const label = typeof parsed.label === "string" ? parsed.label : undefined;
      const event: JournalEvent = { type: parsed.type, key: parsed.key, phase };
      if (label) event.label = label;
      if (parsed.type === "result" && "result" in parsed) event.result = parsed.result;
      events.push(event);
    } catch {
      // skip malformed journal lines
    }
  }
  return events;
}

export function applyJournalToPhases(titles: string[], events: JournalEvent[]): WorkflowPhase[] {
  const titleSet = new Set(titles);
  const started = new Map<string, Set<string>>();
  const finished = new Map<string, Set<string>>();
  const stepsByPhase = new Map<string, Map<string, WorkflowStep>>();
  let parent: string | undefined;

  const ensure = (map: Map<string, Set<string>>, title: string): Set<string> => {
    const existing = map.get(title);
    if (existing) return existing;
    const created = new Set<string>();
    map.set(title, created);
    return created;
  };

  const ensureSteps = (title: string): Map<string, WorkflowStep> => {
    const existing = stepsByPhase.get(title);
    if (existing) return existing;
    const created = new Map<string, WorkflowStep>();
    stepsByPhase.set(title, created);
    return created;
  };

  for (const event of events) {
    let phase = event.phase;
    if (titleSet.has(phase)) parent = phase;
    else phase = parent ?? "";
    if (!phase || !titleSet.has(phase)) continue;
    if (event.type === "started") {
      ensure(started, phase).add(event.key);
      const steps = ensureSteps(phase);
      const previous = steps.get(event.key);
      const summary = previous?.summary;
      steps.set(event.key, {
        key: event.key,
        label: event.label ?? previous?.label ?? event.key,
        status: "in_progress",
        ...(summary ? { summary } : {}),
      });
    } else {
      ensure(finished, phase).add(event.key);
      const steps = ensureSteps(phase);
      const previous = steps.get(event.key);
      const summary = summarizeJournalResult(event.result) ?? previous?.summary;
      steps.set(event.key, {
        key: event.key,
        label: event.label ?? previous?.label ?? event.key,
        status: "completed",
        ...(summary ? { summary } : {}),
      });
    }
  }

  const phases: WorkflowPhase[] = titles.map((title) => {
    const startCount = started.get(title)?.size ?? 0;
    const doneCount = finished.get(title)?.size ?? 0;
    let status: WorkflowPhaseStatus = "pending";
    if (startCount > doneCount) status = "in_progress";
    else if (startCount > 0 || doneCount > 0) status = "completed";
    const stepMap = stepsByPhase.get(title);
    const steps = stepMap ? [...stepMap.values()] : undefined;
    return { title, status, ...(steps && steps.length > 0 ? { steps } : {}) };
  });

  let laterActive = false;
  for (let i = phases.length - 1; i >= 0; i--) {
    if (phases[i].status !== "pending") laterActive = true;
    else if (laterActive) phases[i] = { ...phases[i], status: "completed" };
  }
  return phases;
}
