import type { AppInfo, AuditEntry } from "@tidepush/api";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireHuman } from "../auth/middleware";
import { auditStatement } from "../db";
import type { AppEnv } from "../env";
import { HttpError, parseBody } from "../lib/http";
import { assertCanCreateApp, usageReport } from "../billing";
import { DEFAULT_KEY_ID, generatedKeyStatement, keyEncryptionKey } from "../keys";
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

const serializeApp = (a: AppRow): AppInfo => ({ id: a.id, name: a.name, createdAt: a.created_at, archived: a.archived_at !== null });

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

/**
 * Creates an app. With KEY_ENCRYPTION_KEY set (always, when hosted), the app
 * gets its own signing key "main" straight away; the response includes the
 * certificate to put in the Expo app.
 */
orgRoutes.post("/apps", requireHuman, async (c) => {
  if (!atLeast(c.get("role"), "admin")) throw new HttpError(403, "Your role is read-only. Ask an owner for admin access.");
  const { name } = await parseBody(c, z.object({ name: z.string().trim().min(1, "name is required").max(100) }));
  await assertCanCreateApp(c.env, c.get("orgId"));
  const app: AppRow = { id: newAppId(), name, created_at: new Date().toISOString(), archived_at: null };
  const kek = keyEncryptionKey(c.env);
  const key = kek
    ? await generatedKeyStatement(c.env, await kek, { appId: app.id, keyId: DEFAULT_KEY_ID, appName: name, actor: c.get("actor") })
    : null;
  await c.env.DB.batch([
    ...(key ? [key.statement] : []),
    c.env.DB.prepare(`INSERT INTO apps (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`).bind(
      app.id,
      c.get("orgId"),
      app.name,
      app.created_at,
    ),
    audit(c, { action: "app_create", appId: app.id, target: app.id, details: { name } }),
  ]);
  return c.json(
    { ...serializeApp(app), signingKey: key ? { keyId: DEFAULT_KEY_ID, certificatePem: key.certificatePem } : null },
    201,
  );
});

/**
 * Renames or archives an app. Archived apps leave the dashboard and stop
 * counting toward the plan, but phones keep getting their updates: builds in
 * the field still point at them. Unarchiving counts toward the plan again.
 */
orgRoutes.patch("/apps/:appId", requireHuman, async (c) => {
  if (!atLeast(c.get("role"), "admin")) throw new HttpError(403, "Your role is read-only. Ask an owner for admin access.");
  const body = await parseBody(
    c,
    z.object({ name: z.string().trim().min(1).max(100).optional(), archived: z.boolean().optional() }),
  );
  const db = c.env.DB;
  const appId = c.req.param("appId");
  const app = await db
    .prepare(`SELECT id, name, created_at, archived_at FROM apps WHERE id = ? AND org_id = ?`)
    .bind(appId, c.get("orgId"))
    .first<AppRow>();
  if (!app) throw new HttpError(404, "App not found");
  if (body.archived === false && app.archived_at) await assertCanCreateApp(c.env, c.get("orgId"));
  const archivedAt =
    body.archived === undefined ? app.archived_at : body.archived ? (app.archived_at ?? new Date().toISOString()) : null;
  const updated: AppRow = { ...app, name: body.name ?? app.name, archived_at: archivedAt };
  await db.batch([
    db.prepare(`UPDATE apps SET name = ?, archived_at = ? WHERE id = ?`).bind(updated.name, updated.archived_at, appId),
    audit(c, {
      action: body.archived === true ? "app_archive" : body.archived === false ? "app_unarchive" : "app_rename",
      appId,
      target: appId,
      details: { name: updated.name },
    }),
  ]);
  return c.json(serializeApp(updated));
});

/** The org's plan, limits and this month's usage. */
orgRoutes.get("/usage", async (c) => c.json(await usageReport(c.env, c.get("orgId"))));

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
    .all<AuditEntry>();
  return c.json({ entries: results });
});

export default orgRoutes;
