import keywordsDe from "../data/keywords-de.json";

export type Language = "en" | "de";

export interface LocalKeywords {
  label: string;
  words: string[];
}

/** "en"/"de" are explicit; anything else (incl. "system") follows the system locale. */
export function resolveLanguage(preference: string | undefined, systemLocale: string | undefined): Language {
  if (preference === "en" || preference === "de") return preference;
  return /^de(?![a-z])/i.test(systemLocale ?? "") ? "de" : "en";
}

/** Lower-case, ß to "ss", diacritics stripped (ä to a), so "fröhlich" and "frohlich" are equal. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

let german: Map<string, LocalKeywords> | undefined;

/** Label and words per emoji for a language; null for English (the built-in data). Built lazily once. */
export function localKeywords(language: Language): Map<string, LocalKeywords> | null {
  if (language !== "de") return null;
  german ??= new Map(
    Object.entries(keywordsDe as Record<string, string[]>).map(([emoji, [label, ...words]]) => [
      emoji,
      { label, words },
    ]),
  );
  return german;
}
