import React, { act } from "react";
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  suggest: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  prefs: { channel: "com.tinycast.app", resultCount: "24", primaryAction: "paste" } as Record<string, string | boolean>,
  selected: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  store: new Map<string, string>(),
  showToast: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  pop: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  listRoutes: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  diagnose: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  copy: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
  /** While set, LocalStorage reads wait for it (but see the value as of the call). */
  gate: undefined as Promise<void> | undefined,
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
    Dropdown: Object.assign(host("grid-dropdown"), { Item: host("grid-dropdown-item") }),
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
          Refresh: { modifiers: ["cmd"], key: "r" },
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
      getItem: async (k: string) => {
        const value = h.store.get(k);
        if (h.gate) await h.gate;
        return value;
      },
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
import { lookupBuiltin, BUILTIN_COUNT } from "../src/lib/builtin";
import { NoRouteError } from "../src/lib/suggest";
import { MAX_SELECTION_LENGTH } from "../src/emoji-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;

const grid = () => renderer.root.findByType("grid" as never);
const sections = () =>
  renderer.root.findAllByType("grid-section" as never).map((s: ReactTestInstance) => ({
    title: s.props.title as string,
    contents: s.findAllByType("grid-item" as never).map((i) => i.props.content as string),
  }));
const placeholder = () => grid().props.searchBarPlaceholder as string;
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
  h.gate = undefined;
  h.prefs.primaryAction = "paste";
  delete h.prefs.useSelection;
  h.selected.mockReset();
  h.selected.mockRejectedValue(new Error("nothing selected"));
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
  delete h.prefs.pasteFormat;
  delete h.prefs.combos;
  // The older tests use queries the built-in table answers; the 1.3.0 describe below turns both back on.
  h.prefs.builtin = false;
  h.prefs.searchMemory = false;
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
      tone: "any",
      combos: true,
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
      tone: "any",
      combos: true,
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

  describe("selected text at launch", () => {
    const deferred = () => {
      let resolve!: (v: string) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    it("renders the empty state first, then asks at once with the trimmed selection", async () => {
      h.prefs.useSelection = true;
      const d = deferred();
      h.selected.mockReturnValue(d.promise);
      await mount();
      expect(empty().props.title).toBe("Describe what you want to express");
      expect(placeholder()).toBe("Describe a feeling, situation or thing…");
      expect(h.suggest).not.toHaveBeenCalled();
      await act(async () => d.resolve("  finally friday \n"));
      await flush();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(h.suggest.mock.calls[0][0]).toBe("finally friday");
      expect(placeholder()).toBe("Emojis for selected text “finally friday” — type to search something else");
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      expect(h.showToast).not.toHaveBeenCalled();
    });

    it("reads the selection by default (preference unset)", async () => {
      h.selected.mockResolvedValue("finally friday");
      await mount();
      expect(h.selected).toHaveBeenCalledTimes(1);
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });

    it("caps a long launcher argument at 500 characters and shortens the placeholder", async () => {
      await mount({ arguments: { query: "y".repeat(700) } });
      expect(h.suggest.mock.calls[0][0]).toBe("y".repeat(500));
      expect(placeholder()).toContain("…");
      expect(placeholder()).not.toContain("y".repeat(31));
    });

    it("uses a selection of exactly the limit (300 characters)", async () => {
      expect(MAX_SELECTION_LENGTH).toBe(300);
      h.selected.mockResolvedValue(` ${"y".repeat(MAX_SELECTION_LENGTH)} `);
      await mount();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(h.suggest.mock.calls[0][0]).toBe("y".repeat(MAX_SELECTION_LENGTH));
    });

    it("does not use or send a selection longer than the limit, and says why in the diagnostics", async () => {
      h.selected.mockResolvedValue("y".repeat(MAX_SELECTION_LENGTH + 1));
      await mount();
      await advance(1000);
      expect(h.suggest).not.toHaveBeenCalled();
      expect(empty().props.title).toBe("Describe what you want to express");
      await act(
        async () =>
          void (await renderer.root
            .findAllByType("action" as never)
            .find((a) => a.props.title === "Copy Diagnostics")!
            .props.onAction()),
      );
      const launch = h.diagnose.mock.calls[0][0].launch;
      expect(launch.querySource).toBe("none");
      expect(launch.selection).toEqual({ status: "unused", reason: "selection is longer than 300 characters" });
    });

    it.each([
      ["rejects", () => Promise.reject(new Error("nothing selected"))],
      ["is blank", () => Promise.resolve("   \n ")],
    ])("stays quiet and empty when the selection %s", async (_name, impl) => {
      h.selected.mockImplementation(impl);
      await mount();
      await advance(1000);
      expect(h.showToast).not.toHaveBeenCalled();
      expect(h.suggest).not.toHaveBeenCalled();
      expect(empty().props.title).toBe("Describe what you want to express");
      expect(placeholder()).toBe("Describe a feeling, situation or thing…");
    });

    it("ignores the selection when the user typed before it resolved", async () => {
      const d = deferred();
      h.selected.mockReturnValue(d.promise);
      await mount();
      await type("party");
      await act(async () => d.resolve("finally friday"));
      await advance(450);
      await flush();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(h.suggest.mock.calls[0][0]).toBe("party");
      await type("");
      await flush();
      expect(placeholder()).toBe("Describe a feeling, situation or thing…");
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });

    it("typed text wins and clearing returns to the selection", async () => {
      h.selected.mockResolvedValue("finally friday");
      await mount();
      await type("party");
      await advance(450);
      await flush();
      expect(h.suggest).toHaveBeenLastCalledWith("party", expect.anything());
      expect(placeholder()).toBe("Describe a feeling, situation or thing…");
      await type("");
      await flush();
      expect(placeholder()).toContain("Emojis for selected text “finally friday”");
    });

    it("never reads the selection when the preference is off", async () => {
      h.prefs.useSelection = false;
      h.selected.mockResolvedValue("finally friday");
      await mount();
      await advance(1000);
      expect(h.selected).not.toHaveBeenCalled();
      expect(h.suggest).not.toHaveBeenCalled();
    });

    it("never reads the selection when an argument is given", async () => {
      h.selected.mockResolvedValue("other text");
      await mount({ arguments: { query: "finally friday" } });
      await flush();
      expect(h.selected).not.toHaveBeenCalled();
      expect(h.suggest.mock.calls[0][0]).toBe("finally friday");
      expect(placeholder()).toBe("Emojis for “finally friday” — type to search something else");
    });
  });

  describe("placeholder", () => {
    it("hints at recents with an empty field and goes back to the default when typing", async () => {
      h.store.set("recent-emojis", JSON.stringify(["🎉"]));
      await mount();
      expect(placeholder()).toBe("Recently used — describe a feeling, situation or thing…");
      await type("party");
      expect(placeholder()).toBe("Describe a feeling, situation or thing…");
    });
  });

  describe("launch diagnostics", () => {
    const report = async () => {
      await act(
        async () =>
          void (await renderer.root
            .findAllByType("action" as never)
            .find((a) => a.props.title === "Copy Diagnostics")!
            .props.onAction()),
      );
      return h.diagnose.mock.calls[0][0].launch;
    };

    it("passes a used selection by length, never the text", async () => {
      h.selected.mockResolvedValue("finally friday");
      h.store.set("recent-emojis", JSON.stringify(["🎉", "🥳"]));
      h.store.set("emoji-usage", JSON.stringify({ "🎉": { count: 1, last: 1 } }));
      await mount();
      const launch = await report();
      expect(launch).toEqual({
        querySource: "selection",
        selection: { status: "used", length: 14 },
        recents: ["🎉", "🥳"],
        usageEntries: 1,
        answerSource: "ai",
        searchMemory: "off",
        builtin: "off",
      });
      expect(JSON.stringify(h.diagnose.mock.calls[0][0])).not.toContain("finally friday");
    });

    it("passes the reason when the selection was not available", async () => {
      await mount();
      expect((await report()).selection).toEqual({ status: "unused", reason: "nothing selected" });
      expect(h.diagnose.mock.calls[0][0].launch.querySource).toBe("none");
    });

    it("passes off for the preference", async () => {
      h.prefs.useSelection = false;
      await mount();
      expect((await report()).selection).toEqual({ status: "off" });
    });

    it("passes argument as source and says the selection was not read", async () => {
      await mount({ arguments: { query: "hello" } });
      const launch = await report();
      expect(launch.querySource).toBe("argument");
      expect(launch.selection.status).toBe("unused");
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

  describe("clear and retype", () => {
    it("does not ask again for the old query when the field is cleared and retyped quickly", async () => {
      await mount();
      await type("cat");
      await advance(450);
      await flush();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      await type("");
      await advance(100);
      await type("dog");
      await advance(450);
      await flush();
      expect(h.suggest.mock.calls.map((c) => c[0])).toEqual(["cat", "dog"]);
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

describe("insert format, tray, tone and combinations", () => {
  const items = () => renderer.root.findAllByType("grid-item" as never);
  const itemFor = (content: string) => items().find((i) => i.props.content === content)!;
  const actionsOf = (root: ReactTestInstance) =>
    root.findAll((n) => typeof n.type === "string" && n.type.startsWith("action") && n.props.title !== undefined);
  const action = (root: ReactTestInstance, title: string) => actionsOf(root).find((a) => a.props.title === title);
  const firstAction = (root: ReactTestInstance) =>
    root.findAll(
      (n) => ["action", "action-paste", "action-copy", "action-push"].includes(n.type as string) && !!n.props.title,
    )[0];
  const press = (a: ReactTestInstance | undefined) => act(async () => void (await a!.props.onAction()));
  const used = (a: ReactTestInstance | undefined) => act(async () => void (await a!.props.onPaste?.()));
  const search = async (q = "party") => {
    await mount();
    await type(q);
    await advance(450);
    await flush();
  };
  const accessory = () =>
    grid().props.searchBarAccessory as React.ReactElement<Record<string, unknown> & { onChange: (v: string) => void }>;
  const add = async (content: string) => press(action(itemFor(content), "Add to Selection"));
  const recents = () => JSON.parse(h.store.get("recent-emojis") ?? "[]") as string[];

  describe("insert format", () => {
    it("pastes a GitHub shortcode while the tile still shows the emoji", async () => {
      h.prefs.pasteFormat = "github";
      await search();
      const item = itemFor("🎉");
      const paste = action(item, "Paste Shortcode")!;
      expect(paste.type).toBe("action-paste");
      expect(paste.props.content).toBe(":tada:");
      expect(action(item, "Copy Shortcode")!.props.content).toBe(":tada:");
      expect(action(item, "Paste Emoji")).toBeUndefined();
      // the secondary action now copies the emoji itself
      const second = actionsOf(item).filter((a) => a.props.title === "Copy Emoji");
      expect(second.map((a) => a.props.content)).toEqual(["🎉"]);
      expect(second[0].props.shortcut).toEqual({ modifiers: ["cmd", "opt"], key: "s" });
    });

    it("uses Slack codes and falls back to the emoji without a code in the set", async () => {
      h.prefs.pasteFormat = "slack";
      h.suggest.mockResolvedValue({ emojis: [findEmoji("🫩")!, findEmoji("🎉")!], combos: [], routeLabel: "x" });
      await search();
      expect(action(itemFor("🎉"), "Paste Shortcode")!.props.content).toBe(":tada:");
      expect(action(itemFor("🫩"), "Paste Shortcode")!.props.content).toBe(":face_with_bags_under_eyes:");
    });

    it("pastes the emoji when the GitHub set has no code for it", async () => {
      h.prefs.pasteFormat = "github";
      h.suggest.mockResolvedValue({ emojis: [findEmoji("🫩")!], combos: [], routeLabel: "x" });
      await search();
      expect(action(itemFor("🫩"), "Paste Shortcode")!.props.content).toBe("🫩");
    });

    it("keeps pasting the emoji by default and copies the GitHub code as secondary action", async () => {
      await search();
      const item = itemFor("🎉");
      expect(action(item, "Paste Emoji")!.props.content).toBe("🎉");
      expect(action(item, "Copy Emoji")!.props.content).toBe("🎉");
      expect(action(item, "Copy Shortcode")!.props.content).toBe(":tada:");
    });

    it("falls back to the Slack code, then the slug, for the secondary shortcode", async () => {
      h.suggest.mockResolvedValue({ emojis: [findEmoji("🫩")!], combos: [], routeLabel: "x" });
      await search();
      expect(action(itemFor("🫩"), "Copy Shortcode")!.props.content).toBe(":face_with_bags_under_eyes:");
    });
  });

  describe("selection tray", () => {
    it("adds without closing or toasting, and shows the tray in the placeholder", async () => {
      await search();
      const add1 = action(itemFor("🎉"), "Add to Selection")!;
      expect(add1.type).toBe("action");
      expect(add1.props.shortcut).toEqual({ modifiers: ["opt"], key: "return" });
      await add("🎉");
      await add("🥳");
      expect(placeholder()).toBe("Selection: 🎉🥳 — ⌥⏎ adds, ⏎ pastes");
      expect(h.showToast).not.toHaveBeenCalled();
      expect(h.pop).not.toHaveBeenCalled();
      const item = itemFor("🎉");
      const first = firstAction(item);
      expect(first.type).toBe("action-paste");
      expect(first.props.title).toBe("Paste Selection");
      expect(first.props.content).toBe("🎉🥳");
      expect(actionsOf(item).map((a) => a.props.title as string)).toEqual(
        expect.arrayContaining([
          "Paste Selection",
          "Copy Selection",
          "Add to Selection",
          "Remove Last from Selection",
          "Clear Selection",
          "Paste Emoji",
        ]),
      );
      expect(action(item, "Remove Last from Selection")!.props.shortcut).toEqual({
        modifiers: ["cmd"],
        key: "backspace",
      });
      expect(action(item, "Copy Selection")!.props.content).toBe("🎉🥳");
    });

    it("has no selection actions while the tray is empty", async () => {
      await search();
      expect(action(itemFor("🎉"), "Paste Selection")).toBeUndefined();
      expect(firstAction(itemFor("🎉")).props.title).toBe("Paste Emoji");
    });

    it("joins GitHub shortcodes with spaces", async () => {
      h.prefs.pasteFormat = "github";
      await search();
      await add("🎉");
      await add("🥳");
      expect(action(itemFor("🎉"), "Paste Selection")!.props.content).toBe(":tada: :partying_face:");
      expect(placeholder()).toBe("Selection: 🎉🥳 — ⌥⏎ adds, ⏎ pastes");
    });

    it("removes the last and clears", async () => {
      await search();
      await add("🎉");
      await add("🥳");
      await press(action(itemFor("🎉"), "Remove Last from Selection"));
      expect(placeholder()).toBe("Selection: 🎉 — ⌥⏎ adds, ⏎ pastes");
      await press(action(itemFor("🎉"), "Clear Selection"));
      expect(placeholder()).not.toContain("Selection");
      expect(action(itemFor("🎉"), "Paste Selection")).toBeUndefined();
    });

    it("keeps the tray while typing", async () => {
      await search();
      await add("🎉");
      await type("fire");
      expect(placeholder()).toContain("Selection: 🎉");
    });

    it("records each emoji as used when pasting, then empties the tray", async () => {
      await search();
      await add("🎉");
      await add("🥳");
      await used(action(itemFor("🎉"), "Paste Selection"));
      expect(recents().sort()).toEqual(["🎉", "🥳"].sort());
      expect(Object.keys(JSON.parse(h.store.get("emoji-usage")!)).sort()).toEqual(["🎉", "🥳"].sort());
      expect(placeholder()).not.toContain("Selection");
    });

    it("records each emoji when copying the selection", async () => {
      await search();
      await add("🎉");
      await add("🥳");
      await act(async () => void (await action(itemFor("🎉"), "Copy Selection")!.props.onCopy()));
      expect(recents()).toHaveLength(2);
      expect(placeholder()).not.toContain("Selection");
    });

    it("toasts when the tray is full", async () => {
      await search();
      for (let i = 0; i < 12; i++) await add("🎉");
      expect(h.showToast).not.toHaveBeenCalled();
      await add("🎉");
      expect(h.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Selection is full" }));
    });

    it("offers the tray actions on the empty view", async () => {
      await search();
      await add("🎉");
      await type("");
      expect(sections()).toEqual([]);
      const view = empty();
      expect(action(view, "Paste Selection")!.props.content).toBe("🎉");
      expect(action(view, "Copy Selection")).toBeTruthy();
      expect(action(view, "Remove Last from Selection")).toBeTruthy();
      expect(action(view, "Clear Selection")).toBeTruthy();
      expect(action(view, "Add to Selection")).toBeUndefined();
    });
  });

  describe("tone", () => {
    it("offers a stored Tone dropdown and starts with any", async () => {
      await search();
      const dd = accessory();
      expect(dd.props).toMatchObject({ tooltip: "Tone", storeValue: true });
      const kids = React.Children.toArray(
        (dd.props as unknown as { children: React.ReactNode }).children,
      ) as React.ReactElement<{
        value: string;
      }>[];
      expect(kids.map((k) => k.props.value)).toEqual(["any", "work", "casual", "playful"]);
      expect(h.suggest.mock.calls[0][1]).toMatchObject({ tone: "any" });
    });

    it("asks again for the same query when the tone changes", async () => {
      await search();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      await act(async () => void accessory().props.onChange("work"));
      await advance(450);
      await flush();
      expect(h.suggest).toHaveBeenCalledTimes(2);
      expect(h.suggest.mock.calls[1][0]).toBe("party");
      expect(h.suggest.mock.calls[1][1]).toMatchObject({ tone: "work" });
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });

    it("treats an unknown stored value as any", async () => {
      await search();
      await act(async () => void accessory().props.onChange("bogus"));
      await advance(450);
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });
  });

  describe("combinations", () => {
    const combo = () => [findEmoji("🎉")!, findEmoji("🥳")!, findEmoji("🍾")!];
    const withCombo = () => h.suggest.mockResolvedValue({ ...answer, combos: [combo()] });

    it("shows combo tiles after the AI tiles", async () => {
      withCombo();
      await search();
      expect(sections().map((s) => s.title)).toEqual([
        "AI Suggestions · Claude · test",
        "Combinations",
        "Matching Names",
      ]);
      expect(sections()[1].contents).toEqual(["🎉🥳🍾"]);
      const tile = itemFor("🎉🥳🍾");
      expect(tile.props.title).toBe(
        `Combo · ${combo()
          .map((e) => e.name)
          .join(" + ")}`,
      );
      const first = firstAction(tile);
      expect(first.type).toBe("action-paste");
      expect(first.props.title).toBe("Paste Combination");
      expect(first.props.content).toBe("🎉🥳🍾");
      expect(action(tile, "Copy Combination")!.props.content).toBe("🎉🥳🍾");
      expect(action(tile, "Copy Diagnostics")).toBeTruthy();
    });

    it("puts Copy Combination first with the copy preference and uses the insert format", async () => {
      h.prefs.primaryAction = "copy";
      h.prefs.pasteFormat = "github";
      withCombo();
      await search();
      const tile = itemFor("🎉🥳🍾");
      expect(firstAction(tile).props.title).toBe("Copy Combination");
      expect(action(tile, "Paste Combination")!.props.content).toBe(":tada: :partying_face: :champagne:");
    });

    it("passes combos false and shows no tiles when the preference is off", async () => {
      h.prefs.combos = false;
      withCombo();
      await search();
      expect(h.suggest.mock.calls[0][1]).toMatchObject({ combos: false });
      expect(sections().map((s) => s.title)).not.toContain("Combinations");
    });

    it("never shows combos for the empty query", async () => {
      withCombo();
      await search();
      await type("");
      expect(sections()).toEqual([]);
    });

    it("adds every emoji of a combo to the selection", async () => {
      withCombo();
      await search();
      await press(action(itemFor("🎉🥳🍾"), "Add to Selection"));
      expect(placeholder()).toBe("Selection: 🎉🥳🍾 — ⌥⏎ adds, ⏎ pastes");
    });

    it("records each emoji of a used combo", async () => {
      withCombo();
      await search();
      await used(action(itemFor("🎉🥳🍾"), "Paste Combination"));
      expect(recents().sort()).toEqual(["🎉", "🥳", "🍾"].sort());
    });
  });

  it("passes tone, combos and the insert format to the diagnostics", async () => {
    h.prefs.pasteFormat = "slack";
    await mount();
    await press(action(empty(), "Copy Diagnostics"));
    expect(h.diagnose.mock.calls[0][0]).toMatchObject({ tone: "any", combos: true, insertFormat: "slack" });
  });
});

describe("built-in answers and search memory", () => {
  const Q = "friday night vibes";
  const items = () => renderer.root.findAllByType("grid-item" as never);
  const itemFor = (content: string) => items().find((i) => i.props.content === content)!;
  const actionsOf = (root: ReactTestInstance) =>
    root.findAll((n) => typeof n.type === "string" && n.type.startsWith("action") && n.props.title !== undefined);
  const action = (root: ReactTestInstance, title: string) => actionsOf(root).find((a) => a.props.title === title);
  const press = (a: ReactTestInstance | undefined) => act(async () => void (await a!.props.onAction()));
  const paste = (content: string) =>
    act(
      async () =>
        void (await renderer.root
          .findAllByType("action-paste" as never)
          .find((a) => a.props.content === content)!
          .props.onPaste()),
    );
  const search = async (q: string) => {
    await type(q);
    await advance(700);
    await flush();
  };
  const stored = () => JSON.parse(h.store.get("search-memory") ?? '{"recent":[],"frequent":[]}');
  const entry = (display: string, emojis: string[], over: Record<string, unknown> = {}) => ({
    query: display.toLowerCase(),
    display,
    emojis,
    combos: [],
    model: "Claude · test",
    score: 1,
    last: Date.now(),
    asks: 1,
    ...over,
  });
  const preset = (recent: unknown[], frequent: unknown[] = []) =>
    h.store.set("search-memory", JSON.stringify({ recent, frequent }));
  const remount = async (props: Record<string, unknown> = {}) => {
    act(() => renderer.unmount());
    await mount(props);
  };
  const accessory = () =>
    grid().props.searchBarAccessory as React.ReactElement<Record<string, unknown> & { onChange: (v: string) => void }>;

  beforeEach(() => {
    delete h.prefs.builtin;
    delete h.prefs.searchMemory;
  });

  describe("built-in answers", () => {
    it("shows the table's emojis at once with no AI call and no loading state", async () => {
      await mount();
      await type("thanks");
      const expected = lookupBuiltin("thanks")!.map((e) => e.emoji);
      expect(sections()[0].contents).toEqual(expected);
      expect(items()[0].props.title).toMatch(/^1\. /);
      expect(grid().props.isLoading).toBe(false);
      await advance(2000);
      await flush();
      expect(h.suggest).not.toHaveBeenCalled();
      expect(sections()[0].contents).toEqual(expected);
    });

    it("asks the AI after the debounce when the preference is off", async () => {
      h.prefs.builtin = false;
      await mount();
      await type("thanks");
      expect(h.suggest).not.toHaveBeenCalled();
      await advance(450);
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });

    it("skips the table for a tone other than any", async () => {
      await mount();
      act(() => accessory().props.onChange("work"));
      await type("thanks");
      await advance(450);
      await flush();
      expect(h.suggest).toHaveBeenCalledWith("thanks", expect.objectContaining({ tone: "work" }));
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });

    it("Refresh Suggestions (⌘R) asks the AI with refresh and replaces the tiles", async () => {
      await mount();
      await type("thanks");
      const refresh = action(items()[0], "Refresh Suggestions");
      expect(refresh!.props.shortcut).toEqual({ modifiers: ["cmd"], key: "r" });
      await press(refresh);
      await flush();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(h.suggest).toHaveBeenCalledWith("thanks", expect.objectContaining({ refresh: true }));
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });

    it("offers Refresh on the empty view of a query, but not without a query", async () => {
      await mount();
      expect(action(empty(), "Refresh Suggestions")).toBeUndefined();
      await type("zzzqq");
      expect(action(empty(), "Refresh Suggestions")).toBeTruthy();
    });
  });

  describe("search memory", () => {
    it("records an AI answer for a typed query", async () => {
      await mount();
      await search(Q);
      expect(stored().recent).toEqual([entry(Q, ["🎉", "🥳"], { last: expect.any(Number) })]);
    });

    it("records a launcher argument", async () => {
      await mount({ arguments: { query: Q } });
      await flush();
      expect(stored().recent.map((e: { query: string }) => e.query)).toEqual([Q]);
    });

    it("does not record a query that came from selected text", async () => {
      h.selected.mockResolvedValue(Q);
      await mount();
      await flush();
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      expect(h.store.get("search-memory")).toBeUndefined();
      await press(action(items()[0], "Refresh Suggestions"));
      await flush();
      expect(h.store.get("search-memory")).toBeUndefined();
    });

    it("answers a remembered query at once without the AI, and a stay counts as the second ask", async () => {
      await mount();
      await search(Q);
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(stored().frequent).toEqual([]);
      h.suggest.mockClear();
      h.suggest.mockResolvedValue({ emojis: [findEmoji("🔥")!], routeLabel: "other" });
      await remount();
      await type(Q);
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      expect(grid().props.isLoading).toBe(false);
      await advance(700);
      await flush();
      expect(h.suggest).not.toHaveBeenCalled();
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      // The rule: an answer, from the AI or from memory, counts once per visit when the user stays on the query.
      expect(stored().recent).toEqual([]);
      expect(stored().frequent.map((e: { query: string; asks: number }) => [e.query, e.asks])).toEqual([[Q, 2]]);
    });

    it("counts a query only once per visit", async () => {
      preset([entry(Q, ["🎉"])]);
      await mount();
      await search(Q);
      act(() => accessory().props.onChange("playful"));
      await advance(700);
      await flush();
      expect(stored().frequent[0].asks).toBe(2);
    });

    it("shows stored combos", async () => {
      preset([entry(Q, ["🎉", "🥳"], { combos: [["🎉", "🥳", "🍾"]] })]);
      await mount();
      await type(Q);
      expect(sections().map((x) => x.title)).toContain("Combinations");
      expect(itemFor("🎉🥳🍾")).toBeTruthy();
    });

    it("stores and shows nothing when the preference is off", async () => {
      h.prefs.searchMemory = false;
      preset([entry(Q, ["🔥"])]);
      await mount();
      expect(sections()).toEqual([]);
      await search(Q);
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      expect(stored().recent.map((e: { query: string }) => e.query)).toEqual([Q]);
      expect(stored().recent[0].emojis).toEqual(["🔥"]);
    });

    it("does not create the key when the preference is off", async () => {
      h.prefs.searchMemory = false;
      await mount();
      await search(Q);
      expect(h.store.has("search-memory")).toBe(false);
    });

    it("a pick from a remembered search counts double", async () => {
      preset([], [entry(Q, ["🎉", "🥳"])]);
      await mount();
      await search(Q);
      const before = stored().frequent[0].score;
      await paste("🥳");
      expect(stored().frequent[0].score).toBeCloseTo(before + 2, 4);
    });

    it("a pick from a built-in answer records it as a Built-in search", async () => {
      await mount();
      await type("thanks");
      const first = lookupBuiltin("thanks")![0].emoji;
      await paste(first);
      const all = [...stored().recent, ...stored().frequent];
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ query: "thanks", model: "Built-in" });
      expect(all[0].score).toBeCloseTo(3, 3);
    });

    it("never records a built-in pick for a selection query", async () => {
      h.selected.mockResolvedValue("thanks");
      await mount();
      await flush();
      await paste(lookupBuiltin("thanks")![0].emoji);
      expect(h.store.get("search-memory")).toBeUndefined();
    });

    it("Refresh replaces the stored answer", async () => {
      preset([entry(Q, ["🎉", "🥳"])]);
      await mount();
      await type(Q);
      h.suggest.mockResolvedValue({ emojis: [findEmoji("🔥")!, findEmoji("💯")!], routeLabel: "Claude · fresh" });
      await press(action(items()[0], "Refresh Suggestions"));
      await flush();
      expect(h.suggest).toHaveBeenCalledWith(Q, expect.objectContaining({ refresh: true }));
      expect(sections()[0].contents).toEqual(["🔥", "💯"]);
      const all = [...stored().recent, ...stored().frequent];
      expect(all[0]).toMatchObject({ emojis: ["🔥", "💯"], model: "Claude · fresh" });
    });

    it("a failed Refresh keeps the tiles and toasts the error", async () => {
      await mount();
      await search(Q);
      const before = h.store.get("search-memory");
      h.suggest.mockRejectedValue(new Error("boom"));
      await press(action(items()[0], "Refresh Suggestions"));
      await flush();
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      expect(h.showToast).toHaveBeenCalledWith(expect.objectContaining({ style: "failure", message: "boom" }));
      expect(h.store.get("search-memory")).toBe(before);
      expect(grid().props.isLoading).toBe(false);
    });
  });

  describe("empty screen", () => {
    const two = () => preset([entry("late snack", ["🍕", "🌮"], { last: 1 }), entry(Q, ["🎉", "🥳"], { last: 2 })]);
    const searchTiles = () => sections().find((x) => x.title === "Searches");

    it("shows one tile per remembered search after the recents", async () => {
      h.store.set("recent-emojis", JSON.stringify(["🔥"]));
      two();
      await mount();
      expect(sections().map((x) => x.title)).toEqual(["Recently Used", "Searches"]);
      expect(searchTiles()!.contents).toEqual(["🎉", "🍕"]);
      expect(items().map((i) => i.props.title as string)).toContain(`Search · ${Q}`);
      expect(placeholder()).toBe("Recently used and your searches — describe a feeling, situation or thing…");
    });

    it("says 'Your searches' without recents and uses the skin tone", async () => {
      h.prefs.skinTone = "dark";
      preset([entry("thumbs", ["👍"])]);
      await mount();
      expect(placeholder()).toBe("Your searches — describe a feeling, situation or thing…");
      expect(searchTiles()!.contents).toEqual(["👍🏿"]);
    });

    it("Show Results displays the stored answer without the AI and names it in the placeholder", async () => {
      two();
      await mount();
      const tile = items().find((i) => i.props.title === `Search · ${Q}`)!;
      expect(firstTitle(tile)).toBe("Show Results");
      expect(h.pop).not.toHaveBeenCalled();
      await press(action(tile, "Show Results"));
      await advance(450);
      await flush();
      expect(h.suggest).not.toHaveBeenCalled();
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
      expect(placeholder()).toBe(`Results for “${Q}” — type to search something else`);
    });

    it("typed text wins over the chosen search and clearing returns to it", async () => {
      two();
      await mount();
      await press(
        action(
          items().find((i) => i.props.title === `Search · ${Q}`)!,
          "Show Results",
        ),
      );
      await type("zzzqq");
      expect(placeholder()).toBe("Describe a feeling, situation or thing…");
      await type("");
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });

    it("Back to Start returns to the empty screen", async () => {
      two();
      await mount();
      await press(
        action(
          items().find((i) => i.props.title === `Search · ${Q}`)!,
          "Show Results",
        ),
      );
      await press(action(items()[0], "Back to Start"));
      expect(sections().map((x) => x.title)).toEqual(["Searches"]);
      expect(action(items()[0], "Back to Start")).toBeUndefined();
    });

    it("Forget This Search removes the tile and the stored entry", async () => {
      two();
      await mount();
      const tile = items().find((i) => i.props.title === `Search · ${Q}`)!;
      const forget = action(tile, "Forget This Search");
      expect(forget!.props.shortcut).toEqual({ modifiers: ["ctrl"], key: "x" });
      await press(forget);
      expect(items().map((i) => i.props.title as string)).not.toContain(`Search · ${Q}`);
      expect(stored().recent.map((e: { query: string }) => e.query)).toEqual(["late snack"]);
    });

    it("Clear Search Memory empties the store and the screen", async () => {
      two();
      await mount();
      const clear = action(items()[0], "Clear Search Memory");
      expect(clear!.props.style).toBe("destructive");
      await press(clear);
      expect(sections()).toEqual([]);
      const doc = stored();
      expect([...doc.recent, ...doc.frequent]).toEqual([]);
    });

    it("keeps the model and diagnostics actions on a search tile", async () => {
      two();
      await mount();
      expect(action(items()[0], "Choose AI Model…")).toBeTruthy();
      expect(action(items()[0], "Copy Diagnostics")).toBeTruthy();
    });
  });

  describe("state written before LocalStorage has loaded", () => {
    const hold = () => {
      let open!: () => void;
      h.gate = new Promise<void>((resolve) => (open = resolve));
      return async () => {
        h.gate = undefined;
        open();
        await flush();
      };
    };

    it("a pick before the stored recents are read keeps them", async () => {
      h.store.set("recent-emojis", JSON.stringify(["🔥"]));
      const release = hold();
      await mount();
      await type("party");
      await paste("🎉");
      await release();
      expect(JSON.parse(h.store.get("recent-emojis")!)).toEqual(["🎉", "🔥"]);
      await type("");
      expect(sections()[0].contents).toEqual(["🎉", "🔥"]);
    });

    it("a pick before the stored usage is read keeps the stored counts", async () => {
      h.store.set("emoji-usage", JSON.stringify({ "🔥": { count: 5, last: Date.now() } }));
      const release = hold();
      await mount();
      await type("party");
      await paste("🎉");
      await release();
      const usage = JSON.parse(h.store.get("emoji-usage")!);
      expect(Object.keys(usage).sort()).toEqual(["🎉", "🔥"].sort());
      expect(usage["🔥"].count).toBeCloseTo(5, 3);
    });

    it("a model chosen before the stored choice is read wins over it", async () => {
      h.store.set("model-override", JSON.stringify(haiku));
      const release = hold();
      await mount();
      const target = renderer.root.findAllByType("action-push" as never)[0].props.target as React.ReactElement<{
        onChoose: (o: unknown) => void;
      }>;
      const sonnet = routeChoices[0].override;
      act(() => target.props.onChoose(sonnet));
      await release();
      await type(Q);
      await advance(700);
      expect(h.suggest).toHaveBeenCalledWith(Q, expect.objectContaining({ override: sonnet }));
      expect(JSON.parse(h.store.get("model-override")!)).toEqual(sonnet);
    });

    it("clearing the recents before they are read keeps them cleared", async () => {
      h.store.set("recent-emojis", JSON.stringify(["🔥"]));
      const release = hold();
      await mount();
      await type("party");
      await paste("🎉");
      await press(action(items()[0], "Clear Recently Used"));
      await release();
      await type("");
      expect(sections()).toEqual([]);
      expect(h.store.has("recent-emojis")).toBe(false);
    });
  });

  it("a pick from selected text does not count for a remembered search", async () => {
    preset([], [entry(Q, ["🔥"], { last: 5 })]);
    h.selected.mockResolvedValue(Q);
    await mount();
    await flush();
    expect(sections()[0].contents).toEqual(["🔥"]);
    await paste("🔥");
    expect(stored().frequent).toEqual([entry(Q, ["🔥"], { last: 5 })]);
  });

  describe("mount", () => {
    it("asks once, with the stored tone, when the dropdown reports it right after the first commit", async () => {
      act(() => {
        renderer = TestRenderer.create(
          <Command {...({ arguments: { query: Q } } as React.ComponentProps<typeof Command>)} />,
        );
      });
      act(() => accessory().props.onChange("work"));
      await flush();
      await advance(1000);
      expect(h.suggest).toHaveBeenCalledTimes(1);
      expect(h.suggest).toHaveBeenCalledWith(Q, expect.objectContaining({ tone: "work" }));
    });

    it("asks once for a selection while memory and model load", async () => {
      h.selected.mockResolvedValue(Q);
      await mount();
      await advance(1000);
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });
  });

  describe("search memory and tone", () => {
    const setTone = (t: string) => act(() => accessory().props.onChange(t));

    it("does not use a remembered answer under another tone: the AI is asked with that tone", async () => {
      preset([], [entry(Q, ["🔥"])]);
      await mount();
      setTone("work");
      await type(Q);
      expect(sections().flatMap((x) => x.contents)).not.toContain("🔥");
      await advance(700);
      await flush();
      expect(h.suggest).toHaveBeenCalledWith(Q, expect.objectContaining({ tone: "work" }));
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });

    it("shows the remembered answer again when the tone goes back to any", async () => {
      preset([], [entry(Q, ["🔥"])]);
      await mount();
      setTone("work");
      await search(Q);
      setTone("any");
      await advance(700);
      await flush();
      expect(sections()[0].contents).toEqual(["🔥"]);
      expect(h.suggest).toHaveBeenCalledTimes(1);
    });

    it("neither records nor replaces answers produced under another tone", async () => {
      await mount();
      setTone("playful");
      await search(Q);
      expect(h.store.get("search-memory")).toBeUndefined();
      const before = JSON.stringify(entry(Q, ["🔥"], { last: 5 }));
      preset([], [JSON.parse(before)]);
      await remount();
      setTone("playful");
      await search(Q);
      expect(stored().frequent).toEqual([JSON.parse(before)]);
    });

    it("does not count picks under another tone", async () => {
      preset([], [entry(Q, ["🔥"], { last: 5 })]);
      await mount();
      setTone("work");
      await search(Q);
      await paste("🥳");
      expect(stored().frequent).toEqual([entry(Q, ["🔥"], { last: 5 })]);
    });

    it("does not replace the stored answer when refreshing under another tone", async () => {
      preset([], [entry(Q, ["🔥"], { last: 5 })]);
      await mount();
      setTone("casual");
      await search(Q);
      await press(action(items()[0], "Refresh Suggestions"));
      await flush();
      expect(h.suggest).toHaveBeenLastCalledWith(Q, expect.objectContaining({ tone: "casual", refresh: true }));
      expect(stored().frequent).toEqual([entry(Q, ["🔥"], { last: 5 })]);
    });

    it("keeps the search tiles and asks the AI with the tone when one is chosen", async () => {
      preset([entry(Q, ["🔥"])]);
      await mount();
      setTone("work");
      const tile = items().find((i) => i.props.title === `Search · ${Q}`)!;
      expect(tile).toBeTruthy();
      await press(action(tile, "Show Results"));
      await flush();
      expect(h.suggest).toHaveBeenCalledWith(Q, expect.objectContaining({ tone: "work" }));
      expect(sections()[0].contents).toEqual(["🎉", "🥳"]);
    });
  });

  describe("diagnostics", () => {
    const launch = async () => {
      await press(action(empty() ?? items()[0], "Copy Diagnostics"));
      return h.diagnose.mock.calls[0][0].launch;
    };

    it("reports the source, counts and the table size, never the query", async () => {
      preset([entry(Q, ["🎉"])], [entry("late snack", ["🍕"])]);
      await mount();
      await type(Q);
      const l = await (async () => {
        await press(action(items()[0], "Copy Diagnostics"));
        return h.diagnose.mock.calls[0][0].launch;
      })();
      expect(l).toMatchObject({
        answerSource: "memory",
        searchMemory: { recent: 1, frequent: 1 },
        builtin: { entries: BUILTIN_COUNT },
      });
      expect(JSON.stringify(h.diagnose.mock.calls[0][0])).not.toContain(Q);
      expect(JSON.stringify(h.diagnose.mock.calls[0][0])).not.toContain("late snack");
    });

    it("reports built-in, ai and none", async () => {
      await mount();
      expect((await launch()).answerSource).toBe("none");
      h.diagnose.mockClear();
      await type("thanks");
      await press(action(items()[0], "Copy Diagnostics"));
      expect(h.diagnose.mock.calls[0][0].launch.answerSource).toBe("builtin");
      h.diagnose.mockClear();
      await search(Q);
      await press(action(items()[0], "Copy Diagnostics"));
      // The first ask of Q was just answered by the AI and remembered.
      expect(["ai", "memory"]).toContain(h.diagnose.mock.calls[0][0].launch.answerSource);
    });

    it("reports both preferences off", async () => {
      h.prefs.builtin = false;
      h.prefs.searchMemory = false;
      await mount();
      expect(await launch()).toMatchObject({ searchMemory: "off", builtin: "off" });
    });
  });
});

function firstTitle(root: ReactTestInstance): string {
  return root.findAll(
    (n) => ["action", "action-paste", "action-copy", "action-push"].includes(n.type as string) && !!n.props.title,
  )[0].props.title as string;
}
