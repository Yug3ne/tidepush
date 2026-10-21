import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AdminIdentity, AppEnv, AppVariables, Principal, Role } from "../env";
import { HttpError, isMutating } from "../lib/http";
import { DEFAULT_ORG_ID, appAccess, atLeast, implicitApp, implicitOrg, orgAccess } from "../tenancy";
import { internalUserOf } from "../internal";
import { findApiToken, matchesEnvToken } from "./tokens";

type Auth = Pick<AppVariables, "actor" | "principal" | "admin" | "via">;

/**
 * Every /admin request needs one of:
 *   1. the web app, through the Internal entrypoint, acting for the person it signed in,
 *   2. a bearer API token: `tp_…` from the DB, or a break-glass ADMIN_API_TOKENS entry.
 * This only establishes who is calling. What they may touch is checked per
 * org or app by the scope middleware below.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await authenticate(c);
  c.set("actor", auth.actor);
  c.set("principal", auth.principal);
  c.set("admin", auth.admin);
  c.set("via", auth.via);
  await next();
});

const userPrincipal = (a: AdminIdentity): Principal => ({
  kind: "user",
  user: { id: a.id, email: a.email, name: a.name },
});

async function authenticate(c: Context<AppEnv>): Promise<Auth> {
  const db = c.env.DB;

  // The web app, through the Internal entrypoint, acting for a person it signed in.
  const internalUserId = internalUserOf(c.req.raw);
  if (internalUserId) {
    const admin = await db
      .prepare(
        `SELECT a.id, a.email, a.name, ${PRIMARY_ROLE_SQL} AS role FROM admins a WHERE a.id = ? AND a.disabled_at IS NULL`,
      )
      .bind(internalUserId)
      .first<AdminIdentity>();
    if (!admin) throw new HttpError(401, "Unauthorized");
    return { actor: admin.email, principal: userPrincipal(admin), admin, via: "internal" };
  }

  const bearer = c.req
    .header("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (bearer) {
    const token = await findApiToken(db, bearer);
    if (token) {
      return {
        actor: `token:${token.name}`,
        principal: { kind: "token", tokenId: token.id, name: token.name, orgId: token.org_id, appId: token.app_id },
        admin: null,
        via: "token",
      };
    }
    // Break-glass tokens are a self-hosting feature: they act on the default org only.
    if (await matchesEnvToken(bearer, c.env)) {
      return {
        actor: "env-token",
        principal: { kind: "env-token", orgId: DEFAULT_ORG_ID },
        admin: null,
        via: "env-token",
      };
    }
  }

  throw new HttpError(401, "Unauthorized");
}

/** SQL for a person's role in their first org, for responses that show a single role. */
export const PRIMARY_ROLE_SQL = `(SELECT m.role FROM memberships m WHERE m.user_id = a.id ORDER BY m.created_at LIMIT 1)`;

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

/** For /admin/* and /auth/*: never cache, never frame. */
export const apiSecurityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(BASE_HEADERS)) c.res.headers.set(k, v);
  c.res.headers.set("cache-control", "no-store");
});
