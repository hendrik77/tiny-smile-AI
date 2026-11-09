import { describe, it, expect } from "vitest";
import { readApiKey, readRequestHeaders } from "../src/lib/keychain";
import type { ExecFn } from "../src/lib/types";

function mock(result: { stdout?: string; error?: string }) {
  const calls: Array<[string, string[]]> = [];
  const exec: ExecFn = async (file, args) => {
    calls.push([file, args]);
    if (result.error !== undefined) throw new Error(result.error);
    return { stdout: result.stdout ?? "", stderr: "" };
  };
  return { exec, calls };
}
const NOT_FOUND = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.";

describe("readApiKey", () => {
  it("runs security with exact argv and trims newline", async () => {
    const m = mock({ stdout: "sk-123\n" });
    expect(await readApiKey("com.tinycast.app", "UUID-1", m.exec)).toBe("sk-123");
    expect(m.calls).toEqual([
      ["/usr/bin/security", ["find-generic-password", "-s", "com.tinycast.app.ai-api-keys", "-a", "UUID-1", "-w"]],
    ]);
  });
  it("returns null when not found", async () => {
    expect(await readApiKey("b", "U", mock({ error: NOT_FOUND }).exec)).toBeNull();
  });
  it("returns null on empty output", async () => {
    expect(await readApiKey("b", "U", mock({ stdout: "\n" }).exec)).toBeNull();
  });
  it("rethrows other failures with a clear message", async () => {
    await expect(readApiKey("b", "U", mock({ error: "User interaction is not allowed." }).exec)).rejects.toThrow(
      /Could not read API key from the keychain.*User interaction/,
    );
  });
});

describe("readRequestHeaders", () => {
  it("uses the headers service and parses JSON", async () => {
    const m = mock({ stdout: '{"X-A":"1","X-B":2,"X-C":"c"}\n' });
    expect(await readRequestHeaders("b", "U", m.exec)).toEqual({ "X-A": "1", "X-C": "c" });
    expect(m.calls[0][1]).toEqual(["find-generic-password", "-s", "b.ai-request-headers", "-a", "U", "-w"]);
  });
  it("returns {} when not found, garbled, or not an object", async () => {
    expect(await readRequestHeaders("b", "U", mock({ error: NOT_FOUND }).exec)).toEqual({});
    expect(await readRequestHeaders("b", "U", mock({ stdout: "nope" }).exec)).toEqual({});
    expect(await readRequestHeaders("b", "U", mock({ stdout: "[1]" }).exec)).toEqual({});
  });
  it("rethrows other failures", async () => {
    await expect(readRequestHeaders("b", "U", mock({ error: "denied" }).exec)).rejects.toThrow(/denied/);
  });
});
