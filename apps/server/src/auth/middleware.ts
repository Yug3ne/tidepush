import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AdminIdentity, AppEnv, AppVariables, Principal, Role } from "../env";
import { HttpError, isMutating, isSameOrigin } from "../lib/http";
import { DEFAULT_ORG_ID, appAccess, atLeast, implicitApp, implicitOrg, orgAccess } from "../tenancy";
import { verifyAccessJwt } from "./access";
import { getSession, sessionCookie } from "./session";
import { findApiToken, matchesEnvToken } from "./tokens";

type Auth = Pick<AppVariables, "actor" | "principal" | "admin" | "via" | "sessionHash">;

/**
 * Every /admin request needs one of, checked in this order:
 *   1. the dashboard session cookie (mutations also need a same-origin Origin header),
 *   2. a bearer API token: `tp_…` from the DB, or a break-glass ADMIN_API_TOKENS entry,
 *   3. a Cloudflare Access JWT whose email belongs to an active admin.
 * This only establishes who is calling. What they may touch is checked per
 * org or app by the scope middleware below.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  if (auth.via === "session" && isMutating(c.req.method) && !isSameOrigin(c)) {
    throw new HttpError(403, "Cross-origin request refused");
  }
  c.set("actor", auth.actor);
  c.set("principal", auth.principal);
  c.set("admin", auth.admin);
  c.set("via", auth.via);
  c.set("sessionHash", auth.sessionHash);
  await next();
});

const userPrincipal = (a: AdminIdentity): Principal => ({
  kind: "user",
  user: { id: a.id, email: a.email, name: a.name },
});

async function authenticate(c: Context<AppEnv>): Promise<Auth> {
  const db = c.env.DB;

  const cookie = sessionCookie(c);
  if (cookie) {
    const session = await getSession(db, cookie);
    if (session) {
      return {
        actor: session.admin.email,
        principal: userPrincipal(session.admin),
        admin: session.admin,
        via: "session",
        sessionHash: session.tokenHash,
      };
    }
  }

  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const token = await findApiToken(db, bearer);
    if (token) {
      return {
        actor: `token:${token.name}`,
        principal: { kind: "token", tokenId: token.id, name: token.name, orgId: token.org_id, appId: token.app_id },
        admin: null,
        via: "token",
        sessionHash: null,
      };
    }
    // Break-glass tokens are a self-hosting feature: they act on the default org only.
    if (await matchesEnvToken(bearer, c.env)) {
      return {
        actor: "env-token",
        principal: { kind: "env-token", orgId: DEFAULT_ORG_ID },
        admin: null,
        via: "env-token",
        sessionHash: null,
      };
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
      return { actor: admin.email, principal: userPrincipal(admin), admin, via: "access", sessionHash: null };
    }
  }

  throw new HttpError(401, "Unauthorized");
}

/** SQL for a person's role in their first org, for responses that show a single role. */
export const PRIMARY_ROLE_SQL = `(SELECT m.role FROM memberships m WHERE m.user_id = a.id ORDER BY m.created_at LIMIT 1)`;

export async function findActiveAdminByEmail(db: D1Database, email: string): Promise<AdminIdentity | null> {
  return db
    .prepare(
      `SELECT a.id, a.email, a.name, ${PRIMARY_ROLE_SQL} AS role FROM admins a
       WHERE a.email = ? AND a.disabled_at IS NULL`,
    )
    .bind(email)
    .first<AdminIdentity>();
}

// ---- Scope: which org or app a request acts on -------------------------------

function setScope(c: Context<AppEnv>, orgId: string, role: Role) {
  c.set("orgId", orgId);
  c.set("role", role);
  const admin = c.get("admin");
  if (admin) c.set("admin", { ...admin, role });
}

/** `/admin/apps/:appId/*`: the caller must be able to see the app (else 404). */
export const appScope = createMiddleware<AppEnv>(async (c, next) => {
  const { app, role } = await appAccess(c.env.DB, c.get("principal"), c.req.param("appId") ?? "");
  c.set("app", app);
  setScope(c, app.orgId, role);
  await next();
});

/** Unscoped app routes (`/admin/updates`, …): the caller's only app. */
export const implicitAppScope = createMiddleware<AppEnv>(async (c, next) => {
  const appId = await implicitApp(c.env.DB, c.get("principal"));
  const { app, role } = await appAccess(c.env.DB, c.get("principal"), appId);
  c.set("app", app);
  setScope(c, app.orgId, role);
  await next();
});

/** `/admin/orgs/:orgId/*`: the caller must belong to the org (else 404). */
export const orgScope = createMiddleware<AppEnv>(async (c, next) => {
  const orgId = c.req.param("orgId") ?? "";
  setScope(c, orgId, await orgAccess(c.env.DB, c.get("principal"), orgId));
  await next();
});

/** Unscoped org routes (`/admin/admins`, `/admin/tokens`): the caller's only org. */
export const implicitOrgScope = createMiddleware<AppEnv>(async (c, next) => {
  const orgId = await implicitOrg(c.env.DB, c.get("principal"));
  setScope(c, orgId, await orgAccess(c.env.DB, c.get("principal"), orgId));
  await next();
});

/** Members are read-only: changes need admin or owner. */
export const requireWriteAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (isMutating(c.req.method) && !atLeast(c.get("role"), "admin")) {
    throw new HttpError(403, "Your role is read-only. Ask an owner for admin access.");
  }
  await next();
});

/** Member management: owners only. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("admin") || c.get("role") !== "owner") throw new HttpError(403, "Only owners can manage members");
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
