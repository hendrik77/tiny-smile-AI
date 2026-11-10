export const DEFAULT_PLACEHOLDER = "Describe a feeling, situation or thing…";
const MAX_PLACEHOLDER_QUERY = 30;

export type QuerySource = "argument" | "selection";

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
}

/**
 * Tinycast does not draw grid section titles, so the search bar says what the tiles are.
 */
export function searchPlaceholder(input: PlaceholderInput): string {
  if (input.typed) return DEFAULT_PLACEHOLDER;
  if (input.initialQuery) {
    const what = input.source === "selection" ? "Emojis for selected text" : "Emojis for";
    return `${what} “${shortenQuery(input.initialQuery, MAX_PLACEHOLDER_QUERY)}” — type to search something else`;
  }
  if (input.hasRecents)
    return `Recently used — ${DEFAULT_PLACEHOLDER.charAt(0).toLowerCase()}${DEFAULT_PLACEHOLDER.slice(1)}`;
  return DEFAULT_PLACEHOLDER;
}
