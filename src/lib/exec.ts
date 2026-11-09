import { execFile } from "child_process";
import type { ExecFn } from "./types";

/** Promise wrapper around child_process.execFile (manual, no util.promisify: Tinycast shims child_process). */
export const execFileAsync: ExecFn = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: options?.timeoutMs ?? 30000,
        encoding: "utf8",
        ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        if (error) {
          const detail = err.trim();
          const e = new Error(detail ? `${error.message}\n${detail}` : error.message);
          (e as Error & { stderr?: string; stdout?: string }).stderr = err;
          (e as Error & { stderr?: string; stdout?: string }).stdout = out;
          reject(e);
          return;
        }
        resolve({ stdout: out, stderr: err });
      },
    );
    if (options?.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
