import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";

/** Header the web app sets on Internal requests: the id of the person it signed in with Better Auth. */
export const INTERNAL_USER_HEADER = "x-tidepush-user";

// Requests that came through the Internal entrypoint, with the user they act
// for. Keyed by the Request object itself, so nothing that arrives through the
// public entrypoint (headers included) can ever be mistaken for one.
const internalRequests = new WeakMap<Request, string>();

export const internalUserOf = (req: Request): string | undefined => internalRequests.get(req);

type Handler = { fetch(req: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> };

/**
 * The entrypoint for the web app's service binding. Only other Workers bound
 * to it can call it, never the internet. The web app verifies the session
 * with Better Auth and passes the user id; the admin API then applies the same
 * org and app checks as for any signed-in person.
 */
export function internalEntrypoint(app: Handler) {
  return class Internal extends WorkerEntrypoint<Env> {
    override fetch(request: Request): Promise<Response> {
      const userId = request.headers.get(INTERNAL_USER_HEADER);
      const headers = new Headers(request.headers);
      headers.delete(INTERNAL_USER_HEADER);
      const forwarded = new Request(request, { headers });
      if (userId) internalRequests.set(forwarded, userId);
      return Promise.resolve(app.fetch(forwarded, this.env, this.ctx));
    }
  };
}
