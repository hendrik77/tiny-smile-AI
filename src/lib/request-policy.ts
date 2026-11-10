/** How long a CLI tool (claude/codex) may take before we give up. */
export const TOOL_TIMEOUT_MS = 20000;
/** How long an API request may take before we give up. */
export const API_TIMEOUT_MS = 30000;

/** Wait before sending a search to the AI: longer queries are likelier to still be typed. */
export function debounceDelay(query: string): number {
  const length = query.trim().length;
  if (length <= 12) return 450;
  if (length <= 30) return 650;
  return 850;
}
