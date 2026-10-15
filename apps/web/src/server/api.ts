import { env } from "cloudflare:workers";

/** Must match INTERNAL_USER_HEADER in apps/server/src/internal.ts. */
const INTERNAL_USER_HEADER = "x-tidepush-user";

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
  const headers = new Headers({ accept: "application/json", [INTERNAL_USER_HEADER]: userId });
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
