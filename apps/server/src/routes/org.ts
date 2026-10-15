import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireHuman } from "../auth/middleware";
import { auditStatement } from "../db";
import type { AppEnv } from "../env";
import { HttpError, parseBody } from "../lib/http";
import { atLeast, newAppId } from "../tenancy";

/**
 * An org's apps and audit log. Mounted at /admin/orgs/:orgId and, for
 * single-org callers, directly under /admin (`/admin/apps`, `/admin/audit`).
 */
const orgRoutes = new Hono<AppEnv>();

const audit = (c: Context<AppEnv>, entry: { action: string; appId?: string; target?: string; details?: unknown }) =>
  auditStatement(c.env.DB, { ...entry, actor: c.get("actor"), orgId: c.get("orgId") });

interface AppRow {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
}

const serializeApp = (a: AppRow) => ({ id: a.id, name: a.name, createdAt: a.created_at, archived: a.archived_at !== null });

orgRoutes.get("/apps", async (c) => {
  const principal = c.get("principal");
  // A token restricted to one app only sees that app.
  const onlyApp = principal.kind === "token" ? principal.appId : null;
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, created_at, archived_at FROM apps
     WHERE org_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY created_at`,
  )
    .bind(c.get("orgId"), onlyApp)
    .all<AppRow>();
  return c.json({ apps: results.map(serializeApp) });
});

orgRoutes.post("/apps", requireHuman, async (c) => {
  if (!atLeast(c.get("role"), "admin")) throw new HttpError(403, "Your role is read-only. Ask an owner for admin access.");
  const { name } = await parseBody(c, z.object({ name: z.string().trim().min(1, "name is required").max(100) }));
  const app: AppRow = { id: newAppId(), name, created_at: new Date().toISOString(), archived_at: null };
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO apps (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`).bind(
      app.id,
      c.get("orgId"),
      app.name,
      app.created_at,
    ),
    audit(c, { action: "app_create", appId: app.id, target: app.id, details: { name } }),
  ]);
  return c.json(serializeApp(app), 201);
});

/**
 * The org's audit log: everything recorded for the org, plus sign-ins and
 * other personal events of its current members.
 */
orgRoutes.get("/audit", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM audit_log
     WHERE org_id = ?1 OR (org_id IS NULL AND target IN (SELECT user_id FROM memberships WHERE org_id = ?1))
     ORDER BY id DESC LIMIT 200`,
  )
    .bind(c.get("orgId"))
    .all();
  return c.json({ entries: results });
});

export default orgRoutes;
