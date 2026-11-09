import React, { act } from "react";
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  suggest: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  prefs: { channel: "com.tinycast.app", resultCount: "24", primaryAction: "paste" } as Record<string, string>,
  store: new Map<string, string>(),
  showToast: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  pop: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  listRoutes: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));

vi.mock("@raycast/api", async () => {
  const React = await import("react");
  const { vi } = await import("vitest");
  h.showToast = vi.fn();
  h.pop = vi.fn();
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
  const List = Object.assign(host("list"), {
    Section: host("list-section"),
    Item: host("list-item"),
    EmptyView: host("list-empty"),
  });
  class Cache {
    private m = new Map<string, string>();
    get(k: string) {
      return this.m.get(k);
    }
    set(k: string, v: string) {
      this.m.set(k, v);
    }
  }
  return {
    Grid,
    ActionPanel,
    Action,
    List,
    useNavigation: () => ({ pop: h.pop, push: vi.fn() }),
    Icon: new Proxy({}, { get: (_t, k) => String(k) }),
    Toast: { Style: { Success: "success", Failure: "failure", Animated: "animated" } },
    showToast: h.showToast,
    getPreferenceValues: () => h.prefs,
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
  h.listRoutes = vi.fn();
  return { ...actual, createSuggester: () => Object.assign(h.suggest, { listRoutes: h.listRoutes }) };
});

import Command from "../src/ai-emoji-search";
import { findEmoji } from "../src/lib/emoji-data";
import { NoRouteError } from "../src/lib/suggest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;

const grid = () => renderer.root.findByType("grid" as never);
const sections = () =>
  renderer.root.findAllByType("grid-section" as never).map((s: ReactTestInstance) => ({
    title: s.props.title as string,
    contents: s.findAllByType("grid-item" as never).map((i) => i.props.content as string),
  }));
const empty = () => renderer.root.findAllByType("grid-empty" as never)[0];
const type = (text: string) => act(() => void grid().props.onSearchTextChange(text));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

const haiku = { kind: "api", connection: "C1", model: "claude-haiku-4-5" } as const;
const routeChoices = [
  {
    id: "api:C1:claude-sonnet-4-5",
    model: "claude-sonnet-4-5",
    source: "Anthropic Claude",
    override: { kind: "api", connection: "C1", model: "claude-sonnet-4-5" },
    isDefault: true,
  },
  { id: "api:C1:claude-haiku-4-5", model: "claude-haiku-4-5", source: "Anthropic Claude", override: haiku, isDefault: false },
  {
    id: "api:C2:gpt-4.1-mini",
    model: "gpt-4.1-mini",
    source: "OpenAI API",
    override: { kind: "api", connection: "C2", model: "gpt-4.1-mini" },
    isDefault: false,
  },
];

const answer = { emojis: [findEmoji("🎉")!, findEmoji("🥳")!], routeLabel: "Claude · test" };

beforeEach(async () => {
  vi.useFakeTimers();
  h.store.clear();
  h.prefs.primaryAction = "paste";
  h.suggest.mockReset();
  h.suggest.mockResolvedValue(answer);
  h.showToast.mockReset();
  h.pop.mockReset();
  h.listRoutes.mockReset();
  h.listRoutes.mockResolvedValue(routeChoices);
  delete h.prefs.minimizeThinking;
});

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<Command />);
  });
  await flush();
}

afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
});

describe("ai-emoji-search command", () => {
  it("shows the empty view without recents and makes no AI call", async () => {
    await mount();
    expect(empty().props.title).toBe("Describe what you want to express");
    expect(sections()).toEqual([]);
    await advance(1000);
    expect(h.suggest).not.toHaveBeenCalled();
  });

  it("shows name matches at once, then AI suggestions after the debounce", async () => {
    await mount();
    await type("party");
    const first = sections();
    expect(first.map((s) => s.title)).toEqual(["Matching Names"]);
    expect(first[0].contents).toContain("🎉");
    expect(grid().props.isLoading).toBe(true);
    expect(h.suggest).not.toHaveBeenCalled();

    await advance(450);
    expect(h.suggest).toHaveBeenCalledTimes(1);
    expect(h.suggest).toHaveBeenCalledWith("party", {
      bundleId: "com.tinycast.app",
      count: 24,
      override: null,
      minimizeThinking: true,
    });

    await flush();
    const done = sections();
    expect(done[0].title).toBe("AI Suggestions · Claude · test");
    expect(done[0].contents).toEqual(["🎉", "🥳"]);
    const names = done.find((s) => s.title === "Matching Names");
    expect(names?.contents ?? []).not.toContain("🎉");
    expect(names?.contents ?? []).not.toContain("🥳");
    expect(grid().props.isLoading).toBe(false);
  });

  it("debounces fast typing into a single call", async () => {
    await mount();
    await type("pa");
    await advance(200);
    await type("par");
    await advance(200);
    await type("party");
    await advance(450);
    await flush();
    expect(h.suggest).toHaveBeenCalledTimes(1);
    expect(h.suggest.mock.calls[0][0]).toBe("party");
  });

  it("does not call the AI for a single character", async () => {
    await mount();
    await type("a");
    await advance(1000);
    expect(h.suggest).not.toHaveBeenCalled();
    expect(grid().props.isLoading).toBe(false);
  });

  it("toasts when no AI route exists and keeps name matches", async () => {
    h.suggest.mockRejectedValue(new NoRouteError("Apple Intelligence can't be used from an extension."));
    await mount();
    await type("party");
    await advance(450);
    await flush();
    expect(h.showToast).toHaveBeenCalledTimes(1);
    expect(h.showToast.mock.calls[0][0]).toMatchObject({ style: "failure", title: "No AI model available" });
    expect(sections().map((s) => s.title)).toEqual(["Matching Names"]);
    expect(grid().props.isLoading).toBe(false);
  });

  it("never shows a stale answer under a newer query", async () => {
    let resolveCat!: (v: typeof answer) => void;
    h.suggest.mockImplementation((q: string) =>
      q === "cat"
        ? new Promise((res) => {
            resolveCat = res;
          })
        : new Promise(() => {}),
    );
    await mount();
    await type("cat");
    await advance(450);
    expect(h.suggest).toHaveBeenCalledWith("cat", expect.anything());
    await type("dog");
    await advance(450);
    expect(h.suggest).toHaveBeenCalledWith("dog", expect.anything());

    await act(async () => resolveCat({ emojis: [findEmoji("🐱")!], routeLabel: "Claude · test" }));
    await flush();
    expect(sections().flatMap((s) => s.contents)).not.toContain("🐱");
    expect(sections().map((s) => s.title)).not.toContain("AI Suggestions · Claude · test");
  });

  it("remembers pasted emojis as recents", async () => {
    await mount();
    await type("party");
    await advance(450);
    await flush();
    const paste = renderer.root.findAllByType("action-paste" as never).find((a) => a.props.content === "🥳")!;
    await act(async () => paste.props.onPaste());
    await flush();

    await type("");
    expect(sections()).toEqual([{ title: "Recently Used", contents: ["🥳"] }]);
    expect(JSON.parse(h.store.get("recent-emojis")!)).toEqual(["🥳"]);
  });

  it("puts CopyToClipboard first when primaryAction is copy", async () => {
    h.prefs.primaryAction = "copy";
    await mount();
    await type("party");
    const item = renderer.root.findAllByType("grid-item" as never)[0];
    const firstAction = item.findAll((n) => (n.type as unknown) === "action-copy" || (n.type as unknown) === "action-paste")[0];
    expect(firstAction.type).toBe("action-copy");
    expect(firstAction.props.title).toBe("Copy Emoji");
  });

  it("uses the remembered model choice and the speed preference", async () => {
    h.store.set("model-override", JSON.stringify(haiku));
    (h.prefs as Record<string, unknown>).minimizeThinking = false;
    await mount();
    await type("party");
    await advance(450);
    expect(h.suggest).toHaveBeenCalledWith("party", {
      bundleId: "com.tinycast.app",
      count: 24,
      override: haiku,
      minimizeThinking: false,
    });
  });

  it("offers Choose AI Model on items and on the empty view", async () => {
    await mount();
    expect(empty().findAllByType("action-push" as never)[0].props.title).toBe("Choose AI Model…");
    await type("party");
    const item = renderer.root.findAllByType("grid-item" as never)[0];
    expect(item.findAllByType("action-push" as never)[0].props.shortcut).toEqual({ modifiers: ["cmd"], key: "m" });
  });

  it("switching the model in the picker re-asks with the new model and remembers it", async () => {
    await mount();
    await type("party");
    await advance(450);
    expect(h.suggest).toHaveBeenCalledTimes(1);

    const push = renderer.root.findAllByType("action-push" as never)[0];
    let picker!: ReactTestRenderer;
    await act(async () => {
      picker = TestRenderer.create(push.props.target);
    });
    await flush();
    expect(h.listRoutes).toHaveBeenCalledWith("com.tinycast.app");

    const listSections = picker.root.findAllByType("list-section" as never);
    expect(listSections.map((x) => x.props.title)).toEqual(["Default", "Anthropic Claude", "OpenAI API"]);
    const defaultItem = picker.root.findAllByType("list-item" as never)[0];
    expect(defaultItem.props.subtitle).toBe("Anthropic Claude · claude-sonnet-4-5");
    expect(defaultItem.props.accessories).toHaveLength(1); // checkmark: default in use

    const haikuItem = picker.root
      .findAllByType("list-item" as never)
      .find((i) => i.props.id === "api:C1:claude-haiku-4-5")!;
    await act(async () => void haikuItem.findAllByType("action" as never)[0].props.onAction());
    expect(h.pop).toHaveBeenCalled();
    expect(JSON.parse(h.store.get("model-override")!)).toEqual(haiku);
    act(() => picker.unmount());

    await advance(450);
    expect(h.suggest).toHaveBeenCalledTimes(2);
    expect(h.suggest.mock.calls[1][1]).toMatchObject({ override: haiku });
  });

  it("going back to Tinycast Default forgets the choice", async () => {
    h.store.set("model-override", JSON.stringify(haiku));
    await mount();
    const push = renderer.root.findAllByType("action-push" as never)[0];
    let picker!: ReactTestRenderer;
    await act(async () => {
      picker = TestRenderer.create(push.props.target);
    });
    await flush();
    const haikuItem = picker.root
      .findAllByType("list-item" as never)
      .find((i) => i.props.id === "api:C1:claude-haiku-4-5")!;
    expect(haikuItem.props.accessories.some((a: { icon?: string }) => a.icon === "Checkmark")).toBe(true);
    const defaultItem = picker.root.findAllByType("list-item" as never)[0];
    await act(async () => void defaultItem.findAllByType("action" as never)[0].props.onAction());
    expect(h.store.has("model-override")).toBe(false);
    act(() => picker.unmount());
  });
});
