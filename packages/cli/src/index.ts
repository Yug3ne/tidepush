#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ApiError, apiConfigFromEnv, appIdFromUpdatesUrl } from "./api";
import { list, promote, rollback, rollout } from "./commands";
import { publish } from "./publish";

const HELP = `tidepush: publish and manage Expo OTA updates on a Tidepush server

Usage
  tidepush publish  --channel <name> [--platform ios|android|all] [--rollout <pct>] [-m <message>]
                     [--app-dir <dir>] [--runtime-version <v>] [--dist <dir>] [--dry-run]
  tidepush promote  <updateOrGroupId> --to <channel> [--rollout <pct>]
  tidepush rollout  <updateOrGroupId> <pct>
  tidepush rollback <updateOrGroupId> [--to-embedded]
  tidepush list     [--channel <name>] [--platform ios|android] [--runtime-version <v>] [--limit <n>] [--json]

Which app
  --app <appId>         or TIDEPUSH_APP_ID. Otherwise read from updates.url in the app's config
                        (https://…/<appId>/manifest). Without any, the server uses the org's only app.

Environment (bun loads .env automatically)
  TIDEPUSH_SERVER_URL   e.g. https://ota.example.com (or --server)
  TIDEPUSH_API_TOKEN    a tp_… API token, created in the dashboard (Settings → API tokens)
  TIDEPUSH_APP_DIR      app directory for publish (default: cwd, or --app-dir)
  TIDEPUSH_ACCESS_CLIENT_ID / TIDEPUSH_ACCESS_CLIENT_SECRET
                         Access service token, if the server hostname is behind Cloudflare Access

publish runs \`expo export\` in the app with TIDEPUSH_CHANNEL=<channel> set, so the app's
app.config.ts can set updates.requestHeaders["expo-channel-name"] from it.
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      channel: { type: "string" },
      platform: { type: "string" },
      rollout: { type: "string" },
      message: { type: "string", short: "m" },
      "app-dir": { type: "string" },
      "runtime-version": { type: "string" },
      dist: { type: "string" },
      "dry-run": { type: "boolean" },
      to: { type: "string" },
      "to-embedded": { type: "boolean" },
      limit: { type: "string" },
      server: { type: "string" },
      app: { type: "string" },
      json: { type: "boolean" },
    },
  });

  const pct = (v: string | undefined, name: string): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`${name} must be an integer 0–100`);
    return n;
  };
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new Error(`Missing ${what}. Run \`tidepush help\`.`);
    return v;
  };
  const dryRun = values["dry-run"] ?? false;
  const appDir = values["app-dir"] ?? process.env.TIDEPUSH_APP_DIR ?? process.cwd();
  // publish reads the full app config (app.config.ts included) itself; other
  // commands only look at app.json, which is cheap.
  const cfg = (detectApp = true) =>
    apiConfigFromEnv({ server: values.server, app: values.app ?? (detectApp ? appIdFromAppJson(appDir) : undefined) });

  switch (command) {
    case "publish": {
      const platform = values.platform ?? "all";
      if (!["ios", "android", "all"].includes(platform)) throw new Error("--platform must be ios, android or all");
      await publish(dryRun ? null : cfg(false), {
        channel: need(values.channel, "--channel"),
        platforms: platform === "all" ? ["ios", "android"] : [platform as "ios" | "android"],
        rolloutPct: pct(values.rollout, "--rollout") ?? 100,
        message: values.message,
        appDir,
        runtimeVersion: values["runtime-version"],
        distDir: values.dist,
      });
      return;
    }
    case "promote":
      return promote(cfg(), need(positionals[0], "update id"), need(values.to, "--to <channel>"), pct(values.rollout, "--rollout"));
    case "rollout":
      return rollout(cfg(), need(positionals[0], "update id"), pct(need(positionals[1], "percentage"), "percentage")!);
    case "rollback":
      return rollback(cfg(), need(positionals[0], "update id"), values["to-embedded"] ?? false);
    case "list":
      return list(cfg(), {
        channel: values.channel,
        platform: values.platform,
        runtimeVersion: values["runtime-version"],
        limit: values.limit,
        json: values.json ?? false,
      });
    default:
      throw new Error(`Unknown command "${command}". Run \`tidepush help\`.`);
  }
}

function appIdFromAppJson(appDir: string): string | undefined {
  try {
    const config = JSON.parse(readFileSync(join(appDir, "app.json"), "utf8"));
    return appIdFromUpdatesUrl((config.expo ?? config).updates?.url);
  } catch {
    return undefined;
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(`✖ ${e instanceof ApiError || e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
