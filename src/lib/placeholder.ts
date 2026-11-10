export const DEFAULT_PLACEHOLDER = "Describe a feeling, situation or thing…";
const MAX_PLACEHOLDER_QUERY = 30;

export type QuerySource = "argument" | "selection" | "memory";

export function shortenQuery(query: string, max: number): string {
  const flat = query.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export interface PlaceholderInput {
  /** What the user typed (trimmed). */
  typed: string;
  /** The launch query (argument or selection), empty when there is none. */
  initialQuery: string;
  source: QuerySource | null;
  hasRecents: boolean;
  /** Remembered searches are shown as tiles on the empty screen. */
  hasSearches?: boolean;
  /** Emojis (display form) in the multi-pick selection; the placeholder is the only place it is visible. */
  tray?: string[];
}

/**
 * Tinycast does not draw grid section titles, so the search bar says what the tiles are.
 */
export function searchPlaceholder(input: PlaceholderInput): string {
  if (input.tray && input.tray.length > 0) return `Selection: ${input.tray.join("")} — ⌥⏎ adds, ⏎ pastes`;
  if (input.typed) return DEFAULT_PLACEHOLDER;
  if (input.initialQuery && input.source === "memory") {
    return `Results for “${shortenQuery(input.initialQuery, MAX_PLACEHOLDER_QUERY)}” — type to search something else`;
  }
  if (input.initialQuery) {
    const what = input.source === "selection" ? "Emojis for selected text" : "Emojis for";
    return `${what} “${shortenQuery(input.initialQuery, MAX_PLACEHOLDER_QUERY)}” — type to search something else`;
  }
  const hint = `${DEFAULT_PLACEHOLDER.charAt(0).toLowerCase()}${DEFAULT_PLACEHOLDER.slice(1)}`;
  if (input.hasRecents && input.hasSearches) return `Recently used and your searches — ${hint}`;
  if (input.hasSearches) return `Your searches — ${hint}`;
  if (input.hasRecents) return `Recently used — ${hint}`;
  return DEFAULT_PLACEHOLDER;
}
