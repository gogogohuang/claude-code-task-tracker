export type WorkflowPhaseStatus = "pending" | "in_progress" | "completed";

export interface WorkflowPhase {
  title: string;
  status: WorkflowPhaseStatus;
}

export interface JournalEvent {
  type: "started" | "result";
  key: string;
  phase: string;
}

export function parseJournalEvents(raw: string): JournalEvent[] {
  const events: JournalEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if ((parsed.type !== "started" && parsed.type !== "result") || typeof parsed.key !== "string") continue;
      const phase = typeof parsed.phase === "string" ? parsed.phase : "";
      events.push({ type: parsed.type, key: parsed.key, phase });
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
  let parent: string | undefined;

  const ensure = (map: Map<string, Set<string>>, title: string): Set<string> => {
    const existing = map.get(title);
    if (existing) return existing;
    const created = new Set<string>();
    map.set(title, created);
    return created;
  };

  for (const event of events) {
    let phase = event.phase;
    if (titleSet.has(phase)) parent = phase;
    else phase = parent ?? "";
    if (!phase || !titleSet.has(phase)) continue;
    if (event.type === "started") ensure(started, phase).add(event.key);
    else ensure(finished, phase).add(event.key);
  }

  const phases: WorkflowPhase[] = titles.map((title) => {
    const startCount = started.get(title)?.size ?? 0;
    const doneCount = finished.get(title)?.size ?? 0;
    let status: WorkflowPhaseStatus = "pending";
    if (startCount > doneCount) status = "in_progress";
    else if (startCount > 0 || doneCount > 0) status = "completed";
    return { title, status };
  });

  let laterActive = false;
  for (let i = phases.length - 1; i >= 0; i--) {
    if (phases[i].status !== "pending") laterActive = true;
    else if (laterActive) phases[i] = { ...phases[i], status: "completed" };
  }
  return phases;
}
