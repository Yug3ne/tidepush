import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import type { EnvVarInfo, ResolvedEnv } from "@tidepush/api";
import { api, ApiError, appPath, type ApiConfig } from "./api";

/**
 * Build-time variables kept on the server (`tidepush env …`), and what
 * `publish` does with them.
 *
 * Only EXPO_PUBLIC_* names are ever passed to `expo export`, whatever the
 * server answers: these become environment variables of a command on this
 * machine, and a name like PATH or NODE_OPTIONS would run someone else's code.
 */
export const ENV_VAR_NAME = /^EXPO_PUBLIC_[A-Za-z0-9_]{1,100}$/;

const scope = (channel: string | undefined) => (channel ? `channel ${channel}` : "all channels");

/** `NAME=value` arguments. The value is everything after the first `=`. */
export function parseAssignments(args: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq <= 0) throw new Error(`Expected NAME=value, got "${arg}"`);
    vars[arg.slice(0, eq)] = arg.slice(eq + 1);
  }
  return vars;
}

function checkNames(names: string[]) {
  const bad = names.filter((n) => !ENV_VAR_NAME.test(n));
  if (bad.length) {
    throw new Error(`Only EXPO_PUBLIC_* variables can be kept on the server. Not accepted: ${bad.join(", ")}`);
  }
}

export async function envSet(cfg: ApiConfig, vars: Record<string, string>, channel?: string): Promise<void> {
  const names = Object.keys(vars);
  if (!names.length) throw new Error("Give at least one NAME=value. Run `tidepush help`.");
  checkNames(names);
  await api(cfg, appPath(cfg, "/env"), { method: "PUT", json: { channel: channel ?? null, vars } });
  console.log(`✔ Saved ${names.length} variable${names.length === 1 ? "" : "s"} for ${scope(channel)}`);
  for (const name of names) console.log(`  ${name}`);
}

/**
 * Saves the EXPO_PUBLIC_* entries of a .env file. Other entries and empty
 * values are left out, and said so.
 */
export async function envImport(cfg: ApiConfig, file: string, channel?: string): Promise<void> {
  const parsed = parseEnv(await readFile(file, "utf8")) as Record<string, string>;
  const { vars, skipped } = importable(parsed);
  if (skipped.length) console.log(`  Left out (not EXPO_PUBLIC_*, or empty): ${skipped.join(", ")}`);
  if (!Object.keys(vars).length) throw new Error(`${file} has no EXPO_PUBLIC_* variables with a value`);
  await envSet(cfg, vars, channel);
}

export function importable(parsed: Record<string, string>): { vars: Record<string, string>; skipped: string[] } {
  const vars: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (ENV_VAR_NAME.test(name) && value !== "") vars[name] = value;
    else skipped.push(name);
  }
  return { vars, skipped };
}

export async function envList(cfg: ApiConfig, json: boolean): Promise<void> {
  const { vars } = await api<{ vars: EnvVarInfo[] }>(cfg, appPath(cfg, "/env"));
  if (json) {
    console.log(JSON.stringify(vars, null, 2));
    return;
  }
  if (!vars.length) {
    console.log("No variables. Add some with `tidepush env set NAME=value` or `tidepush env import .env`.");
    return;
  }
  console.table(
    vars.map((v) => ({
      name: v.name,
      channel: v.channel ?? "(all)",
      updated: v.updatedAt.replace("T", " ").slice(0, 16),
      by: v.updatedBy,
    })),
  );
  console.log("Values are not shown. `tidepush publish` reads them when it exports.");
}

export async function envRemove(cfg: ApiConfig, name: string, channel?: string): Promise<void> {
  checkNames([name]);
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : "";
  await api(cfg, appPath(cfg, `/env/${encodeURIComponent(name)}${query}`), { method: "DELETE" });
  console.log(`✔ Removed ${name} for ${scope(channel)}`);
}

/**
 * The variables the server keeps for this app and channel, for `expo export`.
 * A server from before this feature has none. Anything else that goes wrong
 * throws: publishing without them would ship a bundle with empty values.
 */
export async function resolveServerEnv(cfg: ApiConfig, channel: string): Promise<Record<string, string>> {
  let resolved: ResolvedEnv;
  try {
    resolved = await api<ResolvedEnv>(cfg, appPath(cfg, "/env/resolve"), { method: "POST", json: { channel } });
  } catch (e) {
    if (isUnknownRoute(e)) return {};
    throw e;
  }
  const vars: Record<string, string> = {};
  const ignored: string[] = [];
  for (const [name, value] of Object.entries(resolved?.vars ?? {})) {
    if (ENV_VAR_NAME.test(name) && typeof value === "string") vars[name] = value;
    else ignored.push(name);
  }
  if (ignored.length)
    console.warn(`! Ignored variables from the server that aren't EXPO_PUBLIC_*: ${ignored.join(", ")}`);
  return vars;
}

/** The server's answer for a path it doesn't have (an unknown app says "App not found" instead). */
const isUnknownRoute = (e: unknown) => e instanceof ApiError && e.status === 404 && /→ 404: Not found$/.test(e.message);
