import { describe, expect, it } from "vitest";
import { API_TIMEOUT_MS, debounceDelay, TOOL_TIMEOUT_MS } from "../src/lib/request-policy";

describe("request policy", () => {
  it("exports the timeouts", () => {
    expect(TOOL_TIMEOUT_MS).toBe(20000);
    expect(API_TIMEOUT_MS).toBe(30000);
  });
  it.each([
    ["", 450],
    ["a".repeat(12), 450],
    ["a".repeat(13), 650],
    ["a".repeat(30), 650],
    ["a".repeat(31), 850],
    ["   " + "a".repeat(12) + "   ", 450],
  ])("debounceDelay(%j) = %i", (q, ms) => {
    expect(debounceDelay(q)).toBe(ms);
  });
});
