import type { EmojiEntry } from "./types";

export interface GridSection {
  id: "recent" | "ai" | "local";
  title: string;
  emojis: EmojiEntry[];
}

export interface SectionInput {
  query: string;
  ai: EmojiEntry[];
  local: EmojiEntry[];
  recents: EmojiEntry[];
  aiTitle?: string;
  localLimit?: number;
}

/** Decides what the grid shows: recents for an empty search, else AI picks then name matches. */
export function buildSections(input: SectionInput): GridSection[] {
  if (!input.query.trim()) {
    return input.recents.length > 0 ? [{ id: "recent", title: "Recently Used", emojis: input.recents }] : [];
  }
  const sections: GridSection[] = [];
  if (input.ai.length > 0) {
    sections.push({ id: "ai", title: input.aiTitle ?? "AI Suggestions", emojis: input.ai });
  }
  const shown = new Set(input.ai.map((e) => e.emoji));
  const local = input.local.filter((e) => !shown.has(e.emoji)).slice(0, input.localLimit ?? 60);
  if (local.length > 0) sections.push({ id: "local", title: "Matching Names", emojis: local });
  return sections;
}
