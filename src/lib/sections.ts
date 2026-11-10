import type { EmojiEntry } from "./types";

export interface GridSection {
  id: "recent" | "ai" | "combos" | "local" | "searches";
  title: string;
  emojis: EmojiEntry[];
  /** Only for the "combos" section: one tile per sequence (`emojis` is empty there). */
  combos?: EmojiEntry[][];
  /** Only for the "searches" section: one tile per remembered search (`emojis` is empty there). */
  searches?: SearchTile[];
}

/** A remembered search as a tile: its first emoji stands for it. */
export interface SearchTile {
  query: string;
  display: string;
  emoji: EmojiEntry;
}

export interface SectionInput {
  query: string;
  ai: EmojiEntry[];
  local: EmojiEntry[];
  recents: EmojiEntry[];
  combos?: EmojiEntry[][];
  searches?: SearchTile[];
  aiTitle?: string;
  localLimit?: number;
}

/** Decides what the grid shows: recents for an empty search, else AI picks then name matches. */
export function buildSections(input: SectionInput): GridSection[] {
  if (!input.query.trim()) {
    const start: GridSection[] = [];
    if (input.recents.length > 0) start.push({ id: "recent", title: "Recently Used", emojis: input.recents });
    if (input.searches && input.searches.length > 0) {
      start.push({ id: "searches", title: "Searches", emojis: [], searches: input.searches });
    }
    return start;
  }
  const sections: GridSection[] = [];
  if (input.ai.length > 0) {
    sections.push({ id: "ai", title: input.aiTitle ?? "AI Suggestions", emojis: input.ai });
  }
  if (input.combos && input.combos.length > 0) {
    sections.push({ id: "combos", title: "Combinations", emojis: [], combos: input.combos });
  }
  const shown = new Set(input.ai.map((e) => e.emoji));
  const local = input.local.filter((e) => !shown.has(e.emoji)).slice(0, input.localLimit ?? 60);
  if (local.length > 0) sections.push({ id: "local", title: "Matching Names", emojis: local });
  return sections;
}
