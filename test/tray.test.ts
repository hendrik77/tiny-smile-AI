import { describe, expect, it } from "vitest";
import { TRAY_MAX, addToTray, clearTray, emptyTray, isEmpty, removeLast } from "../src/lib/tray";

describe("tray", () => {
  it("starts empty", () => {
    expect(isEmpty(emptyTray())).toBe(true);
    expect(emptyTray().items).toEqual([]);
    expect(TRAY_MAX).toBe(12);
  });

  it("adds immutably and allows duplicates", () => {
    const t0 = emptyTray();
    const t1 = addToTray(t0, "🎉");
    const t2 = addToTray(t1, "🎉");
    expect(t0.items).toEqual([]);
    expect(t2.items).toEqual(["🎉", "🎉"]);
    expect(isEmpty(t2)).toBe(false);
  });

  it("returns the same tray when full", () => {
    let t = emptyTray();
    for (let i = 0; i < TRAY_MAX; i++) t = addToTray(t, "😀");
    expect(t.items).toHaveLength(12);
    expect(addToTray(t, "🎉")).toBe(t);
  });

  it("removes the last item immutably", () => {
    const t = addToTray(addToTray(emptyTray(), "🎉"), "🥳");
    expect(removeLast(t).items).toEqual(["🎉"]);
    expect(t.items).toEqual(["🎉", "🥳"]);
    expect(removeLast(emptyTray()).items).toEqual([]);
  });

  it("clears", () => {
    expect(isEmpty(clearTray())).toBe(true);
  });
});
