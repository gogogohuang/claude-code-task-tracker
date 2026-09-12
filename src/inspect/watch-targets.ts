import { dirname } from "node:path";
import { InspectModel } from "./types.js";

export function watchTargets(model: InspectModel): string[] {
  const targets = new Set<string>([model.cwd, model.configDir]);
  for (const entry of model.entries) {
    targets.add(entry.absolutePath);
    targets.add(dirname(entry.absolutePath));
  }
  return [...targets];
}
