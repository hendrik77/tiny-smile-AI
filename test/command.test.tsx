import React, { act } from "react";
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  suggest: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  prefs: { channel: "com.tinycast.app", resultCount: "24", primaryAction: "paste" } as Record<string, string>,
  selected: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  store: new Map<string, string>(),
  showToast: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  pop: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  listRoutes: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  diagnose: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  copy: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));

vi.mock("@raycast/api", async () => {
  const React = await import("react");
  const { vi } = await import("vitest");
  h.showToast = vi.fn();
  h.pop = vi.fn();
  h.copy = vi.fn();
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
    Keyboard: {
      Shortcut: {
        Common: {
          Copy: { modifiers: ["cmd", "shift"], key: "c" },
          CopyName: { modifiers: ["cmd", "opt"], key: "c" },
        },
      },
    },
    Icon: new Proxy({}, { get: (_t, k) => String(k) }),
    Toast: { Style: { Success: "success", Failure: "failure", Animated: "animated" } },
    showToast: h.showToast,
    Clipboard: { copy: h.copy },
    getSelectedText: h.selected,
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
  h.diagnose = vi.fn();
  return {
    ...actual,
    createSuggester: () => Object.assign(h.suggest, { listRoutes: h.listRoutes, diagnose: h.diagnose }),
  };
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
  {
    id: "api:C1:claude-haiku-4-5",
    model: "claude-haiku-4-5",
    source: "Anthropic Claude",
    override: haiku,
    isDefault: false,
  },
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
  h.diagnose.mockReset();
  h.diagnose.mockResolvedValue("REPORT TEXT");
  h.copy.mockReset();
  h.copy.mockResolvedValue(undefined);
  delete h.prefs.minimizeThinking;
  delete h.prefs.skinTone;
  delete h.prefs.language;
});

async function mount(props: Record<string, unknown> = {}) {
  await act(async () => {
    renderer = TestRenderer.create(<Command {...(props as React.ComponentProps<typeof Command>)} />);
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
    const firstAction = item.findAll(
      (n) => (n.type as unknown) === "action-copy" || (n.type as unknown) === "action-paste",
    )[0];
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

  describe("Copy Diagnostics", () => {
    const diagAction = (root: ReactTestInstance) =>
      root.findAllByType("action" as never).find((a) => a.props.title === "Copy Diagnostics");

    it("is offered on the empty view and on items", async () => {
      await mount();
      const onEmpty = diagAction(empty());
      expect(onEmpty?.props.icon).toBe("Bug");
      expect(onEmpty?.props.shortcut).toEqual({ modifiers: ["cmd", "shift"], key: "d" });
      await type("party");
      const item = renderer.root.findAllByType("grid-item" as never)[0];
      expect(diagAction(item)).toBeTruthy();
    });

    it("copies the report and shows a success toast", async () => {
      await mount();
      await act(async () => void (await diagAction(empty())!.props.onAction()));
      expect(h.diagnose).toHaveBeenCalledTimes(1);
      const opts = h.diagnose.mock.calls[0][0];
      expect(opts).toMatchObject({
        bundleId: "com.tinycast.app",
        count: 24,
        override: null,
        minimizeThinking: true,
        lastError: undefined,
      });
      expect(typeof opts.extensionVersion).toBe("string");
      expect(opts.extensionVersion.length).toBeGreaterThan(0);
      expect(h.copy).toHaveBeenCalledWith("REPORT TEXT");
      expect(h.showToast).toHaveBeenLastCalledWith({
        style: "success",
        title: "Diagnostics copied",
        message: "Paste them into a GitHub issue",
      });
    });

    it("passes the last AI error", async () => {
      h.suggest.mockRejectedValue(new Error("HTTP 401: unauthorized"));
      await mount();
      await type("party");
      await advance(450);
      await flush();
      const item = renderer.root.findAllByType("grid-item" as never)[0];
      await act(async () => void (await diagAction(item)!.props.onAction()));
      expect(h.diagnose.mock.calls[0][0].lastError).toBe("HTTP 401: unauthorized");
    });
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

  describe("launcher argument", () => {
    const withQuery = (query: string) => ({ arguments: { query } });

    it("asks at once with the argument and names it in the AI section title", async () => {
      await mount(withQuery("finally friday"));
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(h.suggest.mock.calls[0][0]).toBe("finally friday");
      await flush();
      expect(sections()[0].title).toBe("AI Suggestions for “finally friday” · Claude · test");
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });

    it("uses the argument for name matches and passes no searchText to the grid", async () => {
      h.suggest.mockReturnValue(new Promise(() => {}));
      await mount(withQuery("party"));
      expect(sections().map((s) => s.title)).toEqual(["Matching Names"]);
      expect(sections()[0].contents).toContain("🎉");
      expect(grid().props.searchText).toBeUndefined();
    });

    it("typing replaces the argument and the title loses the 'for' part", async () => {
      await mount(withQuery("finally friday"));
      await flush();
      await type("party");
      await advance(450);
      await flush();
      expect(h.suggest).toHaveBeenLastCalledWith("party", expect.anything());
      expect(sections()[0].title).toBe("AI Suggestions · Claude · test");
    });

    it("clearing the typed text goes back to the argument", async () => {
      await mount(withQuery("finally friday"));
      await flush();
      await type("party");
      await advance(450);
      await flush();
      await type("");
      await flush();
      expect(sections()[0].title).toBe("AI Suggestions for “finally friday” · Claude · test");
    });

    it("shortens a long argument in the title but sends up to 500 characters", async () => {
      const long = "x".repeat(600);
      await mount(withQuery(`  ${long}  `));
      expect(h.suggest.mock.calls[0][0]).toBe("x".repeat(500));
      await flush();
      const title = sections()[0].title;
      expect(title).toContain("…");
      expect(title).not.toContain("x".repeat(41));
    });

    it("tolerates missing props, arguments and a blank query", async () => {
      for (const props of [{}, { arguments: undefined }, { arguments: { query: "   " } }]) {
        await mount(props);
        act(() => renderer.unmount());
      }
      await mount();
      await advance(1000);
      expect(h.suggest).not.toHaveBeenCalled();
      expect(empty().props.title).toBe("Describe what you want to express");
    });
  });

  describe("debounce", () => {
    it("fires a 20-character query only after 650 ms", async () => {
      await mount();
      await type("a".repeat(20));
      await advance(450);
      expect(h.suggest).not.toHaveBeenCalled();
      await advance(200);
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });
  });

  describe("skin tone", () => {
    it("shows and pastes the toned emoji but remembers the base emoji", async () => {
      h.prefs.skinTone = "medium";
      await mount();
      await type("thumbs up");
      const item = renderer.root.findAllByType("grid-item" as never).find((i) => i.props.content === "👍🏽")!;
      expect(item).toBeTruthy();
      const paste = item.findAllByType("action-paste" as never)[0];
      expect(paste.props.content).toBe("👍🏽");
      expect(item.findAllByType("action-copy" as never)[0].props.content).toBe("👍🏽");
      await act(async () => paste.props.onPaste());
      await flush();
      expect(JSON.parse(h.store.get("recent-emojis")!)).toEqual(["👍"]);
      expect(Object.keys(JSON.parse(h.store.get("emoji-usage")!))).toEqual(["👍"]);
    });

    it("leaves unsupported emojis unchanged", async () => {
      h.prefs.skinTone = "medium";
      await mount();
      await type("party popper");
      const contents = renderer.root.findAllByType("grid-item" as never).map((i) => i.props.content);
      expect(contents).toContain("🎉");
    });
  });

  describe("usage ranking", () => {
    it("ranks a used name match first on a fresh mount, leaving AI order alone", async () => {
      await mount();
      await type("party");
      await advance(450);
      await flush();
      const names = sections().find((s) => s.title === "Matching Names")!.contents;
      const picked = names[names.length - 1];
      expect(names.indexOf(picked)).toBeGreaterThan(0);
      const paste = renderer.root.findAllByType("action-paste" as never).find((a) => a.props.content === picked)!;
      await act(async () => paste.props.onPaste());
      await flush();
      act(() => renderer.unmount());

      await mount();
      await type("party");
      await advance(450);
      await flush();
      const again = sections();
      expect(again[0].contents).toEqual(["🎉", "🥳"]);
      expect(again.find((s) => s.title === "Matching Names")!.contents[0]).toBe(picked);
    });
  });

  describe("language", () => {
    it("finds German names before any AI answer when the language is de", async () => {
      h.prefs.language = "de";
      await mount();
      await type("feuer");
      expect(sections().find((s) => s.title === "Matching Names")?.contents).toContain("🔥");
      expect(h.suggest).not.toHaveBeenCalled();
    });

    it("does not with English only", async () => {
      h.prefs.language = "en";
      await mount();
      await type("feuer");
      expect(sections().flatMap((s) => s.contents)).not.toContain("🔥");
    });
  });

  it("passes language, system locale and skin tone to the diagnostics", async () => {
    h.prefs.language = "de";
    h.prefs.skinTone = "medium";
    await mount();
    await act(
      async () =>
        void (await empty()
          .findAllByType("action" as never)
          .find((a) => a.props.title === "Copy Diagnostics")!
          .props.onAction()),
    );
    expect(h.diagnose.mock.calls[0][0]).toMatchObject({
      language: "de",
      systemLocale: Intl.DateTimeFormat().resolvedOptions().locale,
      skinTone: "medium",
    });
  });
});
