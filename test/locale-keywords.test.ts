import { describe, expect, it } from "vitest";
import { fold, localKeywords, resolveLanguage } from "../src/lib/locale-keywords";

describe("resolveLanguage", () => {
  it("honours explicit choices", () => {
    expect(resolveLanguage("en", "de-DE")).toBe("en");
    expect(resolveLanguage("de", "en-US")).toBe("de");
  });
  it("maps system locale", () => {
    expect(resolveLanguage("system", "de")).toBe("de");
    expect(resolveLanguage("system", "de-DE")).toBe("de");
    expect(resolveLanguage("system", "de_AT")).toBe("de");
    expect(resolveLanguage("system", "DE-ch")).toBe("de");
    expect(resolveLanguage("system", "fr-FR")).toBe("en");
    expect(resolveLanguage("system", "en-US")).toBe("en");
  });
  it("falls back to English", () => {
    expect(resolveLanguage(undefined, undefined)).toBe("en");
    expect(resolveLanguage(undefined, "de-DE")).toBe("de");
    expect(resolveLanguage("klingon", "en")).toBe("en");
    expect(resolveLanguage("system", undefined)).toBe("en");
  });
});

describe("fold", () => {
  it("lower-cases and strips diacritics", () => {
    expect(fold("Fröhlich")).toBe("frohlich");
    expect(fold("ÄÖÜ")).toBe("aou");
    expect(fold("café")).toBe("cafe");
  });
  it("maps ß to ss", () => {
    expect(fold("Große")).toBe("grosse");
  });
});

describe("localKeywords", () => {
  it("is null for English", () => {
    expect(localKeywords("en")).toBeNull();
  });
  it("has German label and words for fire", () => {
    const m = localKeywords("de");
    expect(m).not.toBeNull();
    const fire = m!.get("🔥");
    expect(fire?.label).toBe("feuer");
    expect(fire?.words).toContain("flamme");
  });
  it("is built once", () => {
    expect(localKeywords("de")).toBe(localKeywords("de"));
  });
});
