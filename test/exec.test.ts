import { describe, it, expect } from "vitest";
import { execFileAsync } from "../src/lib/exec";

describe("execFileAsync", () => {
  it("returns stdout and stderr", async () => {
    const r = await execFileAsync(process.execPath, ["-e", "console.log('hi');console.error('warn')"]);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.stderr.trim()).toBe("warn");
  });
  it("writes input to stdin", async () => {
    const r = await execFileAsync(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "piped" });
    expect(r.stdout).toBe("piped");
  });
  it("passes env merged over process.env", async () => {
    process.env.TS_EXEC_BASE = "base";
    const r = await execFileAsync(
      process.execPath,
      ["-e", "console.log(process.env.TS_EXEC_X + '|' + process.env.TS_EXEC_BASE)"],
      { env: { TS_EXEC_X: "yes" } },
    );
    delete process.env.TS_EXEC_BASE;
    expect(r.stdout.trim()).toBe("yes|base");
  });
  it("rejects with stderr on non-zero exit", async () => {
    await expect(execFileAsync(process.execPath, ["-e", "console.error('boom');process.exit(3)"])).rejects.toThrow(
      /boom/,
    );
  });
  it("rejects when the binary is missing", async () => {
    await expect(execFileAsync("/nonexistent/bin", [])).rejects.toThrow();
  });
});
