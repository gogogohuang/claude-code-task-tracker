export function formatRelativeAge(at: string, now: number = Date.now()): string {
  const ts = new Date(at).getTime();
  if (!Number.isFinite(ts)) return "";
  const diffMinutes = Math.floor(Math.max(0, now - ts) / 60000);
  if (diffMinutes < 1) return "剛剛";
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小時前`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}
