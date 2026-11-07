import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { PublishResult } from "@tidepush/api";
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

/**
 * A package's binary from node_modules/.bin (walking up, for monorepos), so
 * commands skip npx's own startup. Falls back to npx.
 */
export async function localCommand(appDir: string, pkg: string, args: string[]): Promise<[string, string[]]> {
  if (process.platform !== "win32") {
    for (let dir = appDir; ; dir = dirname(dir)) {
      const bin = join(dir, "node_modules", ".bin", pkg);
      if (
        await access(bin, constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        return [bin, args];
      if (dirname(dir) === dir) break;
    }
  }
  return ["npx", [pkg, ...args]];
}

/** The runtime version in the app config, when it's a plain string (no policy to resolve). */
export function literalRuntimeVersion(expoClient: Record<string, unknown>, platform: Platform): string | undefined {
  const platformValue = (expoClient[platform] as { runtimeVersion?: unknown } | undefined)?.runtimeVersion;
  const value = platformValue ?? expoClient.runtimeVersion;
  return typeof value === "string" && value ? value : undefined;
}

const gzipAsync = promisify(gzip);

const UPLOAD_CONCURRENCY = 12;

/** Files this small aren't worth compressing. */
const GZIP_MIN_BYTES = 1024;

/**
 * What to send for one file: gzipped when the server accepts it and that
 * saves at least 10% (JS bundles shrink a lot; PNGs and woff2 don't).
 */
export async function uploadBody(
  bytes: Uint8Array,
  canGzip: boolean,
): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  if (canGzip && bytes.byteLength >= GZIP_MIN_BYTES) {
    const compressed = await gzipAsync(bytes, { level: 6 });
    if (compressed.byteLength < bytes.byteLength * 0.9) {
      return {
        body: compressed,
        headers: { "x-upload-encoding": "gzip", "x-decoded-length": String(bytes.byteLength) },
      };
    }
  }
  return { body: bytes, headers: {} };
}

export async function publish(cfg: ApiConfig | null, opts: PublishOptions): Promise<void> {
  const appDir = resolve(opts.appDir);
  const started = performance.now();
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
  const step = (msg: string) => console.log(`• ${msg}`);
  const runIn = async (pkg: string, args: string[], quiet = true) => {
    const [cmd, argv] = await localCommand(appDir, pkg, args);
    return run(cmd, argv, { cwd: appDir, channel: opts.channel, quiet });
  };

  const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  if (!pkg.dependencies?.["expo-updates"]) throw new Error(`${appDir} does not depend on expo-updates`);

  let distDir = opts.distDir ? resolve(opts.distDir) : undefined;
  let tempDir: string | undefined;
  if (!distDir) {
    tempDir = await mkdtemp(join(tmpdir(), "tidepush-export-"));
    distDir = tempDir;
  }

  try {
    // 1. Export, and alongside it everything that doesn't need the export:
    //    the app config, runtime versions and git info.
    step(
      opts.distDir
        ? "Reading app config and runtime version…"
        : `Exporting ${opts.platforms.join(" + ")} bundle(s) and reading the app config…`,
    );
    const exported = opts.distDir
      ? Promise.resolve()
      : runIn("expo", ["export", ...opts.platforms.flatMap((p) => ["--platform", p]), "--output-dir", distDir], false);
    const config = runIn("expo", ["config", "--type", "public", "--json"]).then((out) =>
      lastJson<Record<string, unknown>>(out),
    );
    const runtimes = config.then(
      async (expoClient) =>
        new Map<Platform, string>(
          await Promise.all(
            opts.platforms.map(async (platform): Promise<[Platform, string]> => {
              const rv =
                opts.runtimeVersion ??
                literalRuntimeVersion(expoClient, platform) ??
                lastJson<{ runtimeVersion: string | null }>(
                  await runIn("expo-updates", ["runtimeversion:resolve", "--platform", platform]),
                ).runtimeVersion;
              if (!rv) throw new Error(`Could not resolve a runtime version for ${platform}`);
              return [platform, rv];
            }),
          ),
        ),
    );
    const gitInfo = Promise.all([git(appDir, ["rev-parse", "HEAD"]), git(appDir, ["status", "--porcelain"])]);
    // Wait for all of them before failing, so the export never outlives the temp dir it writes to.
    const [, expoClient, runtimeVersions, [sha, status]] = await settleAll([
      exported,
      config,
      runtimes,
      gitInfo,
    ] as const);
    if (!opts.distDir) step(`Exported in ${elapsed()}`);

    // The app id is part of updates.url (https://…/<appId>/manifest); --app or TIDEPUSH_APP_ID win.
    if (cfg && !cfg.appId) {
      const fromConfig = appIdFromUpdatesUrl((expoClient.updates as { url?: unknown } | undefined)?.url);
      if (fromConfig) cfg = { ...cfg, appId: fromConfig };
    }
    if (cfg?.appId) console.log(`  app      ${cfg.appId}`);
    const dirty = !!status;
    const gitSha = sha ? `${sha.slice(0, 12)}${dirty ? "-dirty" : ""}` : undefined;
    if (dirty) console.warn("! Working tree has uncommitted changes; they are included in this update.");

    // 2. Hash files
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
      console.log(`✔ Dry run: ${allAssets.size} unique files, ${kb(totalBytes)}. Nothing uploaded. (${elapsed()})`);
      return;
    }

    // 3. Upload what the server doesn't have
    const { missing, uploadEncodings } = await api<{ missing: string[]; uploadEncodings?: string[] }>(
      cfg,
      appPath(cfg, "/assets/missing"),
      {
        method: "POST",
        json: { keys: [...allAssets.keys()] },
      },
    );
    const canGzip = uploadEncodings?.includes("gzip") ?? false;
    const toUpload = missing.map((k) => allAssets.get(k)!);
    step(`Uploading ${toUpload.length}/${allAssets.size} files (${kb(toUpload.reduce((n, a) => n + a.size, 0))})…`);
    let sentBytes = 0;
    await pool(toUpload, UPLOAD_CONCURRENCY, async (a) => {
      const { body, headers } = await uploadBody(await readFile(a.path), canGzip);
      sentBytes += body.byteLength;
      await retry(() =>
        api(cfg!, appPath(cfg!, `/assets/${a.key}`), {
          method: "PUT",
          body,
          headers: { "content-type": a.contentType, "x-file-extension": a.fileExtension, ...headers },
        }),
      );
    });
    if (toUpload.length) step(`Uploaded ${kb(sentBytes)}${canGzip ? " (gzipped where it helps)" : ""} by ${elapsed()}`);

    // 4. Create the update(s)
    const res = await api<PublishResult>(cfg, appPath(cfg, "/updates"), {
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
    });
    console.log(`✔ Published to ${opts.channel} at ${opts.rolloutPct}% (group ${res.groupId}) in ${elapsed()}`);
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

/** Like Promise.all, but waits for every promise to settle before rejecting with the first error. */
async function settleAll<const T extends readonly unknown[]>(
  promises: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as {
    -readonly [K in keyof T]: Awaited<T[K]>;
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}
