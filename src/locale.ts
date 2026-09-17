export type Locale = "zh" | "en";

export function resolveLocale(env: NodeJS.ProcessEnv): Locale {
  const forced = env.TASK_TRACKER_LOCALE?.trim().toLowerCase();
  if (forced === "en" || forced === "zh") return forced;
  const lang = (env.LC_ALL ?? env.LANG ?? "").trim().toLowerCase();
  if (lang.startsWith("en")) return "en";
  return "zh";
}
