import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AdminIdentity, AppEnv, AppVariables } from "../env";
import { HttpError, isMutating, isSameOrigin } from "../lib/http";
import { verifyAccessJwt } from "./access";
import { getSession, sessionCookie } from "./session";
import { findApiToken, matchesEnvToken } from "./tokens";

type Auth = Pick<AppVariables, "actor" | "admin" | "via" | "sessionHash">;

/**
 * Every /admin request needs one of, checked in this order:
 *   1. the dashboard session cookie (mutations also need a same-origin Origin header),
 *   2. a bearer API token: `tp_…` from the DB, or a break-glass ADMIN_API_TOKENS entry,
 *   3. a Cloudflare Access JWT whose email belongs to an active admin.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (auth.via === "session" && isMutating(c.req.method) && !isSameOrigin(c)) {
    throw new HttpError(403, "Cross-origin request refused");
  }
  c.set("actor", auth.actor);
  c.set("admin", auth.admin);
  c.set("via", auth.via);
  c.set("sessionHash", auth.sessionHash);
  await next();
});

async function authenticate(c: Context<AppEnv>): Promise<Auth> {
  const db = c.env.DB;

  const cookie = sessionCookie(c);
  if (cookie) {
    const session = await getSession(db, cookie);
    if (session) {
      return { actor: session.admin.email, admin: session.admin, via: "session", sessionHash: session.tokenHash };
    }
  }

  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const token = await findApiToken(db, bearer);
    if (token) return { actor: `token:${token.name}`, admin: null, via: "token", sessionHash: null };
    if (await matchesEnvToken(bearer, c.env)) {
      return { actor: "env-token", admin: null, via: "env-token", sessionHash: null };
    }
  }

  const jwt = c.req.header("cf-access-jwt-assertion");
  if (jwt && c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) {
    const claims = await verifyAccessJwt(jwt, { teamDomain: c.env.ACCESS_TEAM_DOMAIN, aud: c.env.ACCESS_AUD }).catch(
      (e: Error) => void console.warn("Access JWT rejected:", e.message),
    );
    if (claims) {
      // A valid Access identity is not enough on its own: it must be an active
      // admin here. Service tokens (no email) never are.
      const email = claims.email?.trim().toLowerCase();
      const admin = email ? await findActiveAdminByEmail(db, email) : null;
      if (!admin) throw new HttpError(403, "This Access identity is not a Tidepush admin");
      return { actor: admin.email, admin, via: "access", sessionHash: null };
    }
  }

  throw new HttpError(401, "Unauthorized");
}

export async function findActiveAdminByEmail(db: D1Database, email: string): Promise<AdminIdentity | null> {
  return db
    .prepare(`SELECT id, email, name, role FROM admins WHERE email = ? AND disabled_at IS NULL`)
    .bind(email)
    .first<AdminIdentity>();
}

/** Team management: owners only (signed in via session or Access). */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("admin")?.role !== "owner") throw new HttpError(403, "Only owners can manage admins");
  await next();
});

/** Routes that act on behalf of a person, not an API token. */
export const requireHuman = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("admin")) throw new HttpError(403, "Sign in to the dashboard to do this");
  await next();
});

// ---- Response headers -------------------------------------------------------

const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

export const DASHBOARD_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

/** For /admin/* and /auth/*: never cache, never frame. */
export const apiSecurityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(BASE_HEADERS)) c.res.headers.set(k, v);
  c.res.headers.set("cache-control", "no-store");
});

/** Copies a static-asset response (the dashboard SPA) and adds the security headers and CSP. */
export function withDashboardHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(BASE_HEADERS)) out.headers.set(k, v);
  out.headers.set("content-security-policy", DASHBOARD_CSP);
  return out;
}
