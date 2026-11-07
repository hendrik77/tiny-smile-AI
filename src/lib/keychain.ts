import type { ExecFn } from "./types";

const SECURITY = "/usr/bin/security";

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /could not be found/i.test(err.message);
}

/** Returns the password, or null when the item does not exist. Other failures throw. */
async function findPassword(service: string, account: string, exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec(SECURITY, ["find-generic-password", "-s", service, "-a", account, "-w"]);
    const value = stdout.replace(/\r?\n$/, "");
    return value === "" ? null : value;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function readApiKey(bundleId: string, connectionId: string, exec: ExecFn): Promise<string | null> {
  try {
    const v = await findPassword(`${bundleId}.ai-api-keys`, connectionId, exec);
    return v === null ? null : v.trim() || null;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read API key from the keychain (access may have been denied): ${detail}`,
    );
  }
}

export async function readRequestHeaders(
  bundleId: string,
  connectionId: string,
  exec: ExecFn,
): Promise<Record<string, string>> {
  const raw = await findPassword(`${bundleId}.ai-request-headers`, connectionId, exec);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}
