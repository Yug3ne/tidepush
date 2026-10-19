import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";

/** Header the web app sets on Internal requests: the id of the person it signed in with Better Auth. */
export const INTERNAL_USER_HEADER = "x-tidepush-user";
/** Header the web app sets on Internal requests: its own public URL, for links (invites). */
export const INTERNAL_WEB_URL_HEADER = "x-tidepush-web-url";

interface InternalContext {
  userId: string | null;
  webUrl: string | null;
}

// Requests that came through the Internal entrypoint. Keyed by the Request
// object itself, so nothing that arrives through the public entrypoint
// (headers included) can ever be mistaken for one.
const internalRequests = new WeakMap<Request, InternalContext>();

/** True for requests from the web app (the service binding), never from the internet. */
export const isInternal = (req: Request): boolean => internalRequests.has(req);

/** The person the web app acts for, if any. */
export const internalUserOf = (req: Request): string | undefined => internalRequests.get(req)?.userId ?? undefined;

/** The web app's public URL, as it reported it. */
export const internalWebUrlOf = (req: Request): string | undefined => internalRequests.get(req)?.webUrl ?? undefined;

type Handler = { fetch(req: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> };

/**
 * The entrypoint for the web app's service binding. Only other Workers bound
 * to it can call it, never the internet. The web app verifies the session
 * with Better Auth and passes the user id; the admin API then applies the same
 * org and app checks as for any signed-in person. The account routes under
 * /auth (setup, invites) answer only here.
 */
export function internalEntrypoint(app: Handler) {
  return class Internal extends WorkerEntrypoint<Env> {
    override fetch(request: Request): Promise<Response> {
      const userId = request.headers.get(INTERNAL_USER_HEADER);
      const webUrl = request.headers.get(INTERNAL_WEB_URL_HEADER);
      const headers = new Headers(request.headers);
      headers.delete(INTERNAL_USER_HEADER);
      headers.delete(INTERNAL_WEB_URL_HEADER);
      const forwarded = new Request(request, { headers });
      internalRequests.set(forwarded, { userId: userId || null, webUrl: webUrl || null });
      return Promise.resolve(app.fetch(forwarded, this.env, this.ctx));
    }
  };
}
