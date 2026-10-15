import type { Principal, Role, ScopedApp } from "./env";
import { HttpError } from "./lib/http";

/** The org and app that existing (pre-tenancy) data was moved into. Legacy /manifest and /assets serve this app. */
export const DEFAULT_ORG_ID = "org_default";
export const DEFAULT_APP_ID = "app_default";

/** App ids appear in updates.url, so they are short, lowercase and URL-safe. */
export const APP_ID = /^app_[a-z0-9_]{1,40}$/;
export const ORG_ID = /^org_[a-z0-9_]{1,40}$/;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(prefix: string, length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return prefix + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const newAppId = () => randomId("app_");
export const newOrgId = () => randomId("org_");

/**
 * Where an app's file lives in R2. The default app keeps the pre-tenancy
 * layout so nothing has to be copied; other apps get their own prefix, so a
 * file is only ever reachable through the app that uploaded it.
 */
export const r2KeyFor = (appId: string, key: string) =>
  appId === DEFAULT_APP_ID ? `assets/${key}` : `apps/${appId}/${key}`;

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

interface AppRow {
  id: string;
  org_id: string;
  name: string;
}

export async function findApp(db: D1Database, appId: string): Promise<ScopedApp | null> {
  if (!APP_ID.test(appId)) return null;
  const row = await db.prepare(`SELECT id, org_id, name FROM apps WHERE id = ?`).bind(appId).first<AppRow>();
  return row ? { id: row.id, orgId: row.org_id, name: row.name } : null;
}

/**
 * The caller's role in an org, or null if they have no access. Tokens act as
 * admins of their own org. Unknown or foreign orgs and apps are reported as
 * 404 by the callers, so ids can't be probed.
 */
export async function roleInOrg(db: D1Database, principal: Principal, orgId: string): Promise<Role | null> {
  if (principal.kind !== "user") return principal.orgId === orgId ? "admin" : null;
  const row = await db
    .prepare(
      `SELECT m.role FROM memberships m JOIN orgs o ON o.id = m.org_id
       WHERE m.org_id = ? AND m.user_id = ? AND o.disabled_at IS NULL`,
    )
    .bind(orgId, principal.user.id)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

/** Resolves an app the caller may use, with their role in its org. Throws 404 otherwise. */
export async function appAccess(
  db: D1Database,
  principal: Principal,
  appId: string,
): Promise<{ app: ScopedApp; role: Role }> {
  const app = await findApp(db, appId);
  const role = app ? await roleInOrg(db, principal, app.orgId) : null;
  const restricted = principal.kind === "token" && principal.appId !== null && principal.appId !== appId;
  if (!app || !role || restricted) throw new HttpError(404, "App not found");
  return { app, role };
}

export async function orgAccess(db: D1Database, principal: Principal, orgId: string): Promise<Role> {
  const role = ORG_ID.test(orgId) ? await roleInOrg(db, principal, orgId) : null;
  if (!role) throw new HttpError(404, "Organization not found");
  return role;
}

/**
 * The org for routes that don't name one (`/admin/admins`, `/admin/tokens`,
 * …), as used by the self-hosted dashboard and older CLIs. Tokens use their
 * own org; a person must belong to exactly one org.
 */
export async function implicitOrg(db: D1Database, principal: Principal): Promise<string> {
  if (principal.kind !== "user") return principal.orgId;
  const { results } = await db
    .prepare(
      `SELECT m.org_id FROM memberships m JOIN orgs o ON o.id = m.org_id
       WHERE m.user_id = ? AND o.disabled_at IS NULL ORDER BY m.created_at`,
    )
    .bind(principal.user.id)
    .all<{ org_id: string }>();
  if (results.length === 1) return results[0]!.org_id;
  if (!results.length) throw new HttpError(403, "You are not a member of any organization");
  throw new HttpError(400, "You belong to several organizations. Use /admin/orgs/<orgId>/… instead.");
}

/**
 * The app for routes that don't name one (`/admin/updates`, …). A token
 * restricted to an app uses that app; otherwise the org must have exactly one
 * active app.
 */
export async function implicitApp(db: D1Database, principal: Principal): Promise<string> {
  if (principal.kind === "token" && principal.appId) return principal.appId;
  const orgId = await implicitOrg(db, principal);
  const { results } = await db
    .prepare(`SELECT id FROM apps WHERE org_id = ? AND archived_at IS NULL ORDER BY created_at`)
    .bind(orgId)
    .all<{ id: string }>();
  if (results.length === 1) return results[0]!.id;
  if (!results.length) throw new HttpError(404, "This organization has no apps yet");
  throw new HttpError(
    400,
    `This organization has ${results.length} apps. Choose one: use /admin/apps/<appId>/… (CLI: --app <appId>).`,
  );
}

/** The person's role for responses that show one role (their only org, else their first). */
export async function primaryRole(db: D1Database, userId: string): Promise<Role | null> {
  const row = await db
    .prepare(`SELECT role FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1`)
    .bind(userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}
