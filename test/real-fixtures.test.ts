import { describe, expect, it } from "vitest";
import fixture from "./fixtures/real-claude-cli-haiku.json";
import { formatDiagnostics } from "../src/lib/diagnostics";
import { listRouteChoices, resolveRoute, routeLabel } from "../src/lib/tinycast-settings";
import type { TinycastAISettings } from "../src/lib/types";

// Settings copied from a real Mac's Copy Diagnostics report, so the tests cover a setup that exists.
describe("real Mac: installed Claude tool as default, no API connections", () => {
  const settings = fixture.settings as TinycastAISettings;

  it("resolves to Claude Code with Haiku", () => {
    const resolution = resolveRoute(settings);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.route).toEqual({ kind: "cli", tool: "claude", model: "haiku" });
    expect(routeLabel(resolution.route)).toBe("Claude Code · haiku");
  });

  it("offers Claude Code's models in the picker and marks Haiku as the default", () => {
    const choices = listRouteChoices(settings);
    expect(choices.map((c) => c.model)).toEqual(expect.arrayContaining(["", "haiku", "sonnet", "opus"]));
    expect(choices.filter((c) => c.isDefault).map((c) => c.id)).toEqual(["cli:claude:haiku"]);
    expect(new Set(choices.map((c) => c.id)).size).toBe(choices.length);
  });

  it("falls back to the tool's own model when the default model is Apple Intelligence", () => {
    const apple = { ...settings, defaultModel: { kind: "appleIntelligence" as const } };
    const resolution = resolveRoute(apple);
    expect(resolution.ok && resolution.route).toEqual({ kind: "cli", tool: "claude", model: "" });
  });

  it("does not claim an effort is sent for a tool route", () => {
    const resolution = resolveRoute(settings);
    const report = formatDiagnostics({
      extensionVersion: "1.0.0",
      bundleId: "com.tinycast.app",
      settings,
      rawKeys: fixture.rawKeys,
      override: null,
      resolution,
      cli: { tool: "claude", path: "/opt/homebrew/bin/claude" },
      effort: null,
      minimizeThinking: true,
      resultCount: 24,
      raycastAI: false,
    });
    expect(report).toContain("Resolved route: Claude Code · haiku");
    expect(report).toContain("Effort sent: not used by the Claude Code tool");
    expect(report).not.toContain("Effort sent: none");
  });
});
