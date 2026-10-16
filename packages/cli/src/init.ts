import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { api, type ApiConfig } from "./api";

interface Org {
  id: string;
  name: string;
  role: string;
}
interface App {
  id: string;
  name: string;
  orgId?: string;
}
interface SigningKey {
  keyId: string;
  retired: boolean;
  certificatePem: string;
}

export interface InitOptions {
  appDir: string;
  /** Use this app. */
  appId?: string;
  /** Pick the org (when you belong to several). */
  orgId?: string;
  /** Create a new app with this name instead of picking one. */
  createApp?: string;
  /** The default channel written into the app config. */
  channel?: string;
}

async function choose<T>(question: string, items: T[], label: (t: T) => string): Promise<T> {
  if (items.length === 1) return items[0]!;
  if (!process.stdin.isTTY) {
    throw new Error(`${question} There are several; pass it as a flag (see \`tidepush help\`).`);
  }
  items.forEach((t, i) => console.log(`  ${i + 1}) ${label(t)}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = Number((await rl.question(`${question} [1-${items.length}] `)).trim());
      if (Number.isInteger(answer) && answer >= 1 && answer <= items.length) return items[answer - 1]!;
    }
  } finally {
    rl.close();
  }
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`${question} Pass --create-app <name>.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl.close();
  }
}

/** The app to connect: given, created, or picked from your orgs. */
async function resolveApp(cfg: ApiConfig, opts: InitOptions): Promise<App> {
  if (opts.appId) return api<App>(cfg, `/apps/${encodeURIComponent(opts.appId)}`);

  let orgId = opts.orgId;
  if (!orgId) {
    const me = await api<{ orgs?: Org[] }>(cfg, "/me");
    if (me.orgs) {
      if (!me.orgs.length) throw new Error("You're not in an organization yet. Create one in the dashboard first.");
      orgId = (await choose("Which organization?", me.orgs, (o) => `${o.name} (${o.role})`)).id;
    }
  }
  // With an API token there's no person: the token's own org is used.
  const base = orgId ? `/orgs/${encodeURIComponent(orgId)}` : "";
  if (opts.createApp) return createApp(cfg, base, opts.createApp);
  const { apps } = await api<{ apps: (App & { archived: boolean })[] }>(cfg, `${base}/apps`);
  const active = apps.filter((a) => !a.archived);
  const NEW = { id: "", name: "Create a new app" };
  const picked = await choose("Which app?", active.length ? [...active, NEW] : [NEW], (a) => (a.id ? `${a.name} (${a.id})` : a.name));
  return picked.id ? picked : createApp(cfg, base, await ask("Name of the new app?"));
}

async function createApp(cfg: ApiConfig, base: string, name: string): Promise<App> {
  if (!name) throw new Error("The app needs a name.");
  const app = await api<App>(cfg, `${base}/apps`, { method: "POST", json: { name } });
  console.log(`✔ Created app "${app.name}" (${app.id})`);
  return app;
}

/** Where phones fetch updates: from the web app's public config, or the API server itself. */
async function updatesBase(cfg: ApiConfig): Promise<string> {
  if (cfg.adminBase) {
    const res = await fetch(`${cfg.server}/api/config`);
    if (res.ok) return ((await res.json()) as { updatesUrl: string }).updatesUrl.replace(/\/$/, "");
  }
  return cfg.server;
}

/**
 * `tidepush init`: connects the Expo app in `appDir` to a Tidepush app. Saves
 * the certificate as certs/certificate.pem and writes updates.url, the channel
 * header, code signing and (if unset) runtimeVersion into app.json.
 */
export async function init(cfg: ApiConfig, opts: InitOptions): Promise<void> {
  const appDir = resolve(opts.appDir);
  if (!existsSync(join(appDir, "package.json"))) throw new Error(`${appDir} has no package.json. Run this in your Expo app.`);

  const app = await resolveApp(cfg, opts);
  const scope = { ...cfg, appId: app.id };
  const { keys } = await api<{ keys: SigningKey[] }>(scope, `/apps/${app.id}/keys`);
  const key = keys.find((k) => !k.retired && k.keyId === "main") ?? keys.find((k) => !k.retired);
  if (!key) {
    throw new Error(
      `${app.name} has no signing key with a certificate to download. Add one in the dashboard (App settings → Code signing).`,
    );
  }

  await mkdir(join(appDir, "certs"), { recursive: true });
  await writeFile(join(appDir, "certs", "certificate.pem"), key.certificatePem);
  console.log("✔ Saved certs/certificate.pem");

  const url = `${await updatesBase(cfg)}/${app.id}/manifest`;
  const appJsonPath = join(appDir, "app.json");
  const updates = {
    url,
    codeSigningCertificate: "./certs/certificate.pem",
    codeSigningMetadata: { keyid: key.keyId, alg: "rsa-v1_5-sha256" },
  };

  if (!existsSync(appJsonPath)) {
    console.log("! No app.json here (app.config.ts?). Add these to your config's `expo` object:");
    console.log(
      JSON.stringify(
        { runtimeVersion: { policy: "fingerprint" }, updates: { ...updates, requestHeaders: { "expo-channel-name": opts.channel ?? "production" } } },
        null,
        2,
      ),
    );
    return;
  }

  const raw = JSON.parse(await readFile(appJsonPath, "utf8")) as Record<string, unknown>;
  const expo = (raw.expo ?? raw) as Record<string, unknown>;
  const current = (expo.updates ?? {}) as Record<string, unknown>;
  const headers = (current.requestHeaders ?? {}) as Record<string, string>;
  expo.updates = {
    enabled: true,
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
    ...current,
    ...updates,
    requestHeaders: { ...headers, "expo-channel-name": headers["expo-channel-name"] ?? opts.channel ?? "production" },
  };
  expo.runtimeVersion ??= { policy: "fingerprint" };
  await writeFile(appJsonPath, `${JSON.stringify(raw, null, 2)}\n`);
  console.log("✔ Updated app.json");
  console.log(`  updates.url  ${url}`);
  console.log("Next: make a release build, then `npx tidepush publish --channel production` after it.");
}

