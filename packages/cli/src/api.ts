export interface ApiConfig {
  server: string;
  token: string;
  /** The app to act on. Without one, the server uses the org's only app. */
  appId?: string;
  accessClientId?: string;
  accessClientSecret?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** App ids as they appear in an app's updates.url: `https://…/<appId>/manifest`. */
const APP_ID = /^app_[a-z0-9_]{1,40}$/;

export function appIdFromUpdatesUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).pathname.match(/^\/(app_[a-z0-9_]{1,40})\/manifest\/?$/)?.[1];
  } catch {
    return undefined;
  }
}

/** Prefixes an app-level admin path with the app, when one is known. */
export const appPath = (cfg: ApiConfig, path: string) =>
  cfg.appId ? `/apps/${encodeURIComponent(cfg.appId)}${path}` : path;

export function apiConfigFromEnv(
  overrides: { server?: string; app?: string } = {},
  env: Record<string, string | undefined> = process.env,
): ApiConfig {
  const server = overrides.server ?? env.TIDEPUSH_SERVER_URL;
  const token = env.TIDEPUSH_API_TOKEN;
  if (!server) throw new Error("Set TIDEPUSH_SERVER_URL (or pass --server)");
  if (!token) throw new Error("Set TIDEPUSH_API_TOKEN (create one in the dashboard under Settings → API tokens)");
  const appId = overrides.app ?? env.TIDEPUSH_APP_ID;
  if (appId && !APP_ID.test(appId)) throw new Error(`"${appId}" is not an app id (they look like app_xxxxxxxx)`);
  return {
    server: server.replace(/\/$/, ""),
    token,
    ...(appId ? { appId } : {}),
    accessClientId: env.TIDEPUSH_ACCESS_CLIENT_ID,
    accessClientSecret: env.TIDEPUSH_ACCESS_CLIENT_SECRET,
  };
}

export async function api<T>(
  cfg: ApiConfig,
  path: string,
  init: { method?: string; json?: unknown; body?: RequestInit["body"]; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.token}`, ...init.headers };
  // Lets the CLI reach an admin hostname that sits behind Cloudflare Access.
  if (cfg.accessClientId && cfg.accessClientSecret) {
    headers["cf-access-client-id"] = cfg.accessClientId;
    headers["cf-access-client-secret"] = cfg.accessClientSecret;
  }
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${cfg.server}/admin${path}`, { method: init.method ?? "GET", headers, body });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {}
    throw new ApiError(res.status, `${init.method ?? "GET"} ${path} → ${res.status}: ${message}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
