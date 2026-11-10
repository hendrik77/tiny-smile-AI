import type { EmojiEntry, SkinTone } from "./types";

export type { SkinTone };

const MODIFIERS: Record<Exclude<SkinTone, "none">, string> = {
  light: "\u{1F3FB}",
  "medium-light": "\u{1F3FC}",
  medium: "\u{1F3FD}",
  "medium-dark": "\u{1F3FE}",
  dark: "\u{1F3FF}",
};

const VALID = new Set<string>(["none", ...Object.keys(MODIFIERS)]);

/**
 * Entries the dataset marks as skin-tone capable that are left unchanged.
 * Each is a two-person ZWJ sequence (people holding hands, kisses, couples with heart). Their RGI
 * forms need a modifier after BOTH people, so a single modifier after the first code point would be
 * an invalid sequence that renders as a person plus a stray swatch.
 */
export const SKIN_TONE_EXCLUDED: readonly string[] = [
  "🧑‍🤝‍🧑", // people holding hands
  "👩‍❤️‍💋‍👨", // kiss: woman, man
  "👨‍❤️‍💋‍👨", // kiss: man, man
  "👩‍❤️‍💋‍👩", // kiss: woman, woman
  "👩‍❤️‍👨", // couple with heart: woman, man
  "👨‍❤️‍👨", // couple with heart: man, man
  "👩‍❤️‍👩", // couple with heart: woman, woman
];

export function parseSkinTone(value: unknown): SkinTone {
  return typeof value === "string" && VALID.has(value) ? (value as SkinTone) : "none";
}

/** Insert the tone modifier after the first code point, dropping a U+FE0F that directly follows it. */
export function applySkinTone(entry: EmojiEntry, tone: SkinTone): string {
  if (tone === "none" || !entry.skinTone || SKIN_TONE_EXCLUDED.includes(entry.emoji)) return entry.emoji;
  const [first, ...rest] = Array.from(entry.emoji);
  if (rest[0] === "️") rest.shift();
  return first + MODIFIERS[tone] + rest.join("");
}
