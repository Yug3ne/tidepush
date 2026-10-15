import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { api, ApiError, appIdFromUpdatesUrl, appPath, type ApiConfig } from "./api";
import { readExport, type LocalAsset, type Platform } from "./export";

export interface PublishOptions {
  channel: string;
  platforms: Platform[];
  rolloutPct: number;
  message?: string;
  appDir: string;
  runtimeVersion?: string;
  /** Use an existing `expo export` output instead of exporting. */
  distDir?: string;
}

/**
 * Env for commands run in the app dir. TIDEPUSH_CHANNEL is what the app's
 * app.config.ts reads to set updates.requestHeaders["expo-channel-name"].
 */
export const childEnv = (channel: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...base,
  TIDEPUSH_CHANNEL: channel,
  CI: "1",
});

/** Runs a command in the app dir. */
function run(cmd: string, args: string[], opts: { cwd: string; channel: string; quiet?: boolean }): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: childEnv(opts.channel),
      stdio: ["ignore", "pipe", opts.quiet ? "pipe" : "inherit"],
    });
    let out = "";
    let err = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise(out) : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${err}`)),
    );
  });
}

/** Last JSON object in a command's stdout (npx can print notices first). */
function lastJson<T>(stdout: string): T {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`Expected JSON, got: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

async function git(appDir: string, args: string[]): Promise<string | undefined> {
  try {
    return (await run("git", args, { cwd: appDir, channel: "", quiet: true })).trim();
  } catch {
    return undefined;
  }
}

export async function publish(cfg: ApiConfig | null, opts: PublishOptions): Promise<void> {
  const appDir = resolve(opts.appDir);
  const step = (msg: string) => console.log(`• ${msg}`);
  const runIn = (cmd: string, args: string[], quiet = true) => run(cmd, args, { cwd: appDir, channel: opts.channel, quiet });

  const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  if (!pkg.dependencies?.["expo-updates"]) throw new Error(`${appDir} does not depend on expo-updates`);

  // 1. Export
  let distDir = opts.distDir ? resolve(opts.distDir) : undefined;
  let tempDir: string | undefined;
  if (!distDir) {
    tempDir = await mkdtemp(join(tmpdir(), "tidepush-export-"));
    distDir = tempDir;
    step(`Exporting ${opts.platforms.join(" + ")} bundle(s)…`);
    await runIn("npx", ["expo", "export", ...opts.platforms.flatMap((p) => ["--platform", p]), "--output-dir", distDir], false);
  }

  try {
    // 2. Config, runtime versions, git info
    step("Reading app config and runtime version…");
    const expoClient = lastJson<Record<string, unknown>>(await runIn("npx", ["expo", "config", "--type", "public", "--json"]));
    // The app id is part of updates.url (https://…/<appId>/manifest); --app or TIDEPUSH_APP_ID win.
    if (cfg && !cfg.appId) {
      const fromConfig = appIdFromUpdatesUrl((expoClient.updates as { url?: unknown } | undefined)?.url);
      if (fromConfig) cfg = { ...cfg, appId: fromConfig };
    }
    if (cfg?.appId) console.log(`  app      ${cfg.appId}`);
    const runtimeVersions = new Map<Platform, string>();
    for (const platform of opts.platforms) {
      const rv =
        opts.runtimeVersion ??
        lastJson<{ runtimeVersion: string | null }>(
          await runIn("npx", ["expo-updates", "runtimeversion:resolve", "--platform", platform]),
        ).runtimeVersion;
      if (!rv) throw new Error(`Could not resolve a runtime version for ${platform}`);
      runtimeVersions.set(platform, rv);
    }
    const sha = await git(appDir, ["rev-parse", "HEAD"]);
    const dirty = !!(await git(appDir, ["status", "--porcelain"]));
    const gitSha = sha ? `${sha.slice(0, 12)}${dirty ? "-dirty" : ""}` : undefined;
    if (dirty) console.warn("! Working tree has uncommitted changes; they are included in this update.");

    // 3. Hash files
    const bundles = await readExport(distDir, opts.platforms);
    const allAssets = new Map<string, LocalAsset>();
    for (const b of bundles) for (const a of [b.launchAsset, ...b.assets]) allAssets.set(a.key, a);
    const totalBytes = [...allAssets.values()].reduce((n, a) => n + a.size, 0);

    for (const b of bundles) {
      console.log(
        `  ${b.platform.padEnd(8)} runtime ${runtimeVersions.get(b.platform)}  bundle ${kb(b.launchAsset.size)}  ${b.assets.length} assets`,
      );
    }
    if (!cfg) {
      console.log(`✔ Dry run: ${allAssets.size} unique files, ${kb(totalBytes)}. Nothing uploaded.`);
      return;
    }

    // 4. Upload what the server doesn't have
    const { missing } = await api<{ missing: string[] }>(cfg, appPath(cfg, "/assets/missing"), {
      method: "POST",
      json: { keys: [...allAssets.keys()] },
    });
    const toUpload = missing.map((k) => allAssets.get(k)!);
    step(`Uploading ${toUpload.length}/${allAssets.size} files (${kb(toUpload.reduce((n, a) => n + a.size, 0))})…`);
    await pool(toUpload, 6, async (a) => {
      const body = await readFile(a.path);
      await retry(() =>
        api(cfg!, appPath(cfg!, `/assets/${a.key}`), {
          method: "PUT",
          body,
          headers: { "content-type": a.contentType, "x-file-extension": a.fileExtension },
        }),
      );
    });

    // 5. Create the update(s)
    const res = await api<{ groupId: string; updates: { id: string; platform: Platform; runtimeVersion: string }[] }>(
      cfg,
      appPath(cfg, "/updates"),
      {
        method: "POST",
        json: {
          channel: opts.channel,
          message: opts.message,
          gitSha,
          rolloutPct: opts.rolloutPct,
          updates: bundles.map((b) => ({
            platform: b.platform,
            runtimeVersion: runtimeVersions.get(b.platform),
            launchAssetKey: b.launchAsset.key,
            assetKeys: b.assets.map((a) => a.key),
            extra: { expoClient },
          })),
        },
      },
    );
    console.log(`✔ Published to ${opts.channel} at ${opts.rolloutPct}% (group ${res.groupId})`);
    for (const u of res.updates) console.log(`  ${u.platform.padEnd(8)} ${u.id}`);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

/** Retries network failures and 5xx; client errors (4xx) fail immediately. */
export async function retry<T>(fn: () => Promise<T>, attempts = 4, baseDelayMs = 1000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || (e instanceof ApiError && e.status < 500)) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}
