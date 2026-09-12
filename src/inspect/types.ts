export type InspectSection = "launch" | "onDemand";

export type InspectStatus =
  | "present"
  | "missing"
  | "external"
  | "excluded"
  | "skipped-too-large"
  | "disabled";

export interface InspectEntry {
  id: string;
  section: InspectSection;
  label: string;
  absolutePath: string;
  status: InspectStatus;
  detail?: string;
  trustNote?: string;
  importedBy?: string;
}

export interface InspectModel {
  cwd: string;
  configDir: string;
  headerNotes: string[];
  warnings: string[];
  entries: InspectEntry[];
}

export interface DiscoverOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  managedPolicyPath: string;
}
