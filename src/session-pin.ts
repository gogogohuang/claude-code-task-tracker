export function shouldBlockAutoSelect(pinned: boolean): boolean {
  return pinned;
}

export function shouldBlockNewSessionFocus(pinned: boolean): boolean {
  return pinned;
}

export function pinnedTitleSuffix(pinned: boolean): string {
  return pinned ? " · 已釘選" : "";
}

/** leaveSessionToList 時把 pin 清成 false。 */
export function clearPinOnLeave(): false {
  return false;
}
