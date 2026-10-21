import { env } from "cloudflare:workers";

/** Must match INTERNAL_USER_HEADER and INTERNAL_WEB_URL_HEADER in apps/server/src/internal.ts. */
const INTERNAL_USER_HEADER = "x-tidepush-user";
const INTERNAL_WEB_URL_HEADER = "x-tidepush-web-url";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls the admin API as `userId`, through the API Worker's Internal entrypoint
 * (a service binding: no public network hop, no token in the browser). The API
 * applies its own org and app checks, so a wrong id is a 404, never a leak.
 */
export async function api<T>(
  userId: string,
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; json?: unknown } = {},
): Promise<T> {
  const headers = new Headers({
    accept: "application/json",
    [INTERNAL_USER_HEADER]: userId,
    // Our own public URL, so invite links point here even when the API has no WEB_URL.
    [INTERNAL_WEB_URL_HEADER]: env.BETTER_AUTH_URL,
  });
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const res = await env.API.fetch(
    new Request(`https://api.internal/admin${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    }),
  );
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof message === "string" && message ? message : `Request failed (${res.status})`);
  }
  return data as T;
}

/**
 * Forwards a raw request to the API Worker as `userId` and returns its
 * response unchanged (downloads, the CLI proxy, the /auth account routes).
 * `path` includes /admin or /auth; `userId` null = as no one, for /auth.
 */
export function forward(
  userId: string | null,
  path: string,
  init: { method: string; headers?: Headers; body?: BodyInit | null },
) {
  const headers = new Headers();
  for (const name of ["content-type", "x-file-extension", "accept"]) {
    const value = init.headers?.get(name);
    if (value) headers.set(name, value);
  }
  if (userId) headers.set(INTERNAL_USER_HEADER, userId);
  headers.set(INTERNAL_WEB_URL_HEADER, env.BETTER_AUTH_URL);
  return env.API.fetch(
    new Request(`https://api.internal${path}`, { method: init.method, headers, body: init.body ?? null }),
  );
}

// ---- The /auth account routes ------------------------------------------------------

export type Mode = "hosted" | "selfhost";

export interface ServerStatus {
  mode: Mode;
  /** No accounts yet: the first owner is created at /setup. */
  needsSetup: boolean;
}

export type Result<T> = T | { error: string };

/** Calls an /auth route (setup, invites, status) as no one. Errors come back as `{ error }`. */
export async function account<T>(
  path: string,
  init: { method: "GET" | "POST"; json?: unknown } = { method: "GET" },
): Promise<Result<T>> {
  const res = await forward(null, `/auth${path}`, {
    method: init.method,
    headers: new Headers(init.json === undefined ? {} : { "content-type": "application/json" }),
    body: init.json === undefined ? null : JSON.stringify(init.json),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) return { error: body?.error ?? `Request failed (${res.status})` };
  return body;
}

/** The deployment's mode and whether setup is pending. Throws if the API can't be reached. */
export async function serverStatus(): Promise<ServerStatus> {
  const status = await account<ServerStatus>("/status");
  if ("error" in status) throw new Error(`Couldn't read the server status: ${status.error}`);
  return status;
}
