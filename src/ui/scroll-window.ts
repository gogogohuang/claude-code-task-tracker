export function clampScrollOffset(offset: number, total: number, pageSize: number): number {
  const size = Math.max(1, pageSize);
  const maxOffset = Math.max(0, total - size);
  if (offset < 0) return 0;
  if (offset > maxOffset) return maxOffset;
  return offset;
}

export function visibleSlice<T>(items: readonly T[], offset: number, pageSize: number): T[] {
  const start = clampScrollOffset(offset, items.length, pageSize);
  return items.slice(start, start + Math.max(1, pageSize));
}

export function pageSizeFromTerminal(rows: number, chrome: number): number {
  return Math.max(5, rows - chrome);
}
