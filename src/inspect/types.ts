export type InspectSection = "launch" | "onDemand" | "outOfSession";

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
  /** 檔案位元組數（stat）；缺檔或不存在時可省略 */
  byteSize?: number;
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
