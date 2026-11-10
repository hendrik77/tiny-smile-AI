import React, { act } from "react";
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  suggest: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  selected: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  showToast: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  store: new Map<string, string>(),
}));

vi.mock("@raycast/api", async () => {
  const React = await import("react");
  const { vi } = await import("vitest");
  h.showToast = vi.fn();
  h.selected = vi.fn();
  const host = (tag: string) => (props: Record<string, unknown>) =>
    React.createElement(tag, props, props.children as React.ReactNode, props.actions as React.ReactNode);
  const Grid = Object.assign(host("grid"), {
    Section: host("grid-section"),
    Item: host("grid-item"),
    EmptyView: host("grid-empty"),
    Inset: { Small: "small", Medium: "medium", Large: "large" },
  });
  const ActionPanel = Object.assign(host("action-panel"), { Section: host("action-section") });
  const Action = Object.assign(host("action"), {
    Paste: host("action-paste"),
    CopyToClipboard: host("action-copy"),
    Push: host("action-push"),
    Style: { Regular: "regular", Destructive: "destructive" },
  });
  class Cache {
    get() {
      return undefined;
    }
    set() {}
  }
  return {
    Grid,
    ActionPanel,
    Action,
    List: host("list"),
    useNavigation: () => ({ pop: vi.fn(), push: vi.fn() }),
    Keyboard: { Shortcut: { Common: { CopyName: { modifiers: ["cmd", "opt"], key: "c" } } } },
    Icon: new Proxy({}, { get: (_t, k) => String(k) }),
    Toast: { Style: { Success: "success", Failure: "failure", Animated: "animated" } },
    showToast: h.showToast,
    Clipboard: { copy: vi.fn() },
    getSelectedText: h.selected,
    getPreferenceValues: () => ({ channel: "com.tinycast.app", resultCount: "24", primaryAction: "paste" }),
    environment: { canAccess: () => false },
    AI: { ask: vi.fn() },
    Cache,
    LocalStorage: {
      getItem: async (k: string) => h.store.get(k),
      setItem: async (k: string, v: string) => void h.store.set(k, v),
      removeItem: async (k: string) => void h.store.delete(k),
    },
  };
});

vi.mock("../src/lib/suggest", async (importActual) => {
  const actual = await importActual<typeof import("../src/lib/suggest")>();
  const { vi } = await import("vitest");
  h.suggest = vi.fn();
  return {
    ...actual,
    createSuggester: () => Object.assign(h.suggest, { listRoutes: vi.fn(), diagnose: vi.fn() }),
  };
});

import Command from "../src/emoji-for-selection";
import { findEmoji } from "../src/lib/emoji-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const grid = () => renderer.root.findByType("grid" as never);
const sections = () =>
  renderer.root.findAllByType("grid-section" as never).map((s: ReactTestInstance) => ({
    title: s.props.title as string,
    contents: s.findAllByType("grid-item" as never).map((i) => i.props.content as string),
  }));
const empty = () => renderer.root.findAllByType("grid-empty" as never)[0];
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<Command />);
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  h.store.clear();
  h.showToast.mockReset();
  h.selected.mockReset();
  h.suggest.mockReset();
  h.suggest.mockResolvedValue({ emojis: [findEmoji("🎉")!], routeLabel: "Claude · test" });
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
});

describe("emoji-for-selection command", () => {
  it("shows a loading grid while the selection is read", async () => {
    h.selected.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      renderer = TestRenderer.create(<Command />);
    });
    expect(grid().props.isLoading).toBe(true);
    expect(h.suggest).not.toHaveBeenCalled();
  });

  it("opens the grid with the selected text as initial query and asks at once", async () => {
    h.selected.mockResolvedValue("  finally friday \n");
    await mount();
    expect(h.suggest).toHaveBeenCalledTimes(1);
    expect(h.suggest.mock.calls[0][0]).toBe("finally friday");
    expect(sections()[0].title).toBe("AI Suggestions for “finally friday” · Claude · test");
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("caps long text at 500 characters and shortens it in the title", async () => {
    h.selected.mockResolvedValue("y".repeat(700));
    await mount();
    expect(h.suggest.mock.calls[0][0]).toBe("y".repeat(500));
    const title = sections()[0].title;
    expect(title).toContain("…");
    expect(title).not.toContain("y".repeat(41));
  });

  it.each([
    ["rejects", () => Promise.reject(new Error("nothing selected"))],
    ["is blank", () => Promise.resolve("   \n ")],
  ])("toasts and opens the normal search when the selection %s", async (_name, impl) => {
    h.selected.mockImplementation(impl);
    await mount();
    expect(h.showToast).toHaveBeenCalledWith({
      style: "failure",
      title: "No text selected",
      message: "Select some text first, or type what you want to express.",
    });
    expect(h.suggest).not.toHaveBeenCalled();
    expect(empty().props.title).toBe("Describe what you want to express");
  });
});
