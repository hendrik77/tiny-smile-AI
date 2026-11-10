/** The multi-pick selection: base emojis (dataset form), in insertion order. */
export interface Tray {
  items: string[];
}

export const TRAY_MAX = 12;

export function emptyTray(): Tray {
  return { items: [] };
}

export function clearTray(): Tray {
  return emptyTray();
}

export function isEmpty(tray: Tray): boolean {
  return tray.items.length === 0;
}

/** Adds an emoji; a full tray is returned unchanged (same object). Duplicates are allowed. */
export function addToTray(tray: Tray, emoji: string): Tray {
  if (tray.items.length >= TRAY_MAX) return tray;
  return { items: [...tray.items, emoji] };
}

export function removeLast(tray: Tray): Tray {
  return { items: tray.items.slice(0, -1) };
}
