import { Hono } from "hono";
import { z } from "zod";
import {
  appScope,
  implicitAppScope,
  implicitOrgScope,
  orgScope,
  requireAdmin,
  requireWriteAccess,
} from "../auth/middleware";
import { hashPassword, verifyPassword } from "../auth/password";
import { auditStatement } from "../db";
import type { AppEnv, Role } from "../env";
import { HttpError, parseBody, passwordSchema } from "../lib/http";
import appRoutes from "./app";
import orgRoutes from "./org";
import team from "./team";
import tokens from "./tokens";

/**
 * The admin API. Authentication happens once here; access is checked per org
 * or app by the scope middleware:
 *
 *   /admin/apps/:appId/…   one app (updates, assets, channels, stats, audit)
 *   /admin/orgs/:orgId/…   one org (apps, members, tokens, audit)
 *
 * The older unscoped paths (/admin/updates, /admin/admins, /admin/tokens, …)
 * still work when the caller has exactly one org and that org one app, which
 * is every self-hosted deployment that hasn't created a second app.
 */
const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

// ---- Account ----------------------------------------------------------------

admin.get("/me", async (c) => {
  const principal = c.get("principal");
  const orgs =
    principal.kind === "user"
      ? (
          await c.env.DB.prepare(
            `SELECT o.id, o.slug, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id
             WHERE m.user_id = ? AND o.disabled_at IS NULL ORDER BY m.created_at`,
          )
            .bind(principal.user.id)
            .all<{ id: string; slug: string; name: string; role: Role }>()
        ).results
      : null;
  return c.json({ actor: c.get("actor"), admin: c.get("admin"), via: c.get("via"), ...(orgs ? { orgs } : {}) });
});

/** Changes the signed-in person's password and signs out their other sessions. */
admin.post("/me/password", async (c) => {
  const self = c.get("admin");
  const sessionHash = c.get("sessionHash");
  if (c.get("via") !== "session" || !self || !sessionHash) {
    throw new HttpError(403, "Sign in to the dashboard to change your password");
  }
  const body = await parseBody(c, z.object({ currentPassword: z.string().max(1024), newPassword: passwordSchema }));
  const db = c.env.DB;
  const row = await db.prepare(`SELECT password_hash FROM admins WHERE id = ?`).bind(self.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  await db.batch([
    db.prepare(`UPDATE admins SET password_hash = ? WHERE id = ?`).bind(await hashPassword(body.newPassword), self.id),
    db.prepare(`DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?`).bind(self.id, sessionHash),
    auditStatement(db, { actor: c.get("actor"), action: "password_change", orgId: null, target: self.id }),
  ]);
  return c.body(null, 204);
});

// ---- One app: /admin/apps/:appId/… -------------------------------------------

// `/apps/:appId/*` also matches `/apps/:appId` itself.
admin.use("/apps/:appId/*", appScope, requireWriteAccess);

admin.get("/apps/:appId", (c) => {
  const app = c.get("app");
  return c.json({ id: app.id, orgId: app.orgId, name: app.name, role: c.get("role") });
});

admin.get("/apps/:appId/audit", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM audit_log WHERE app_id = ? ORDER BY id DESC LIMIT 200`)
    .bind(c.get("app").id)
    .all();
  return c.json({ entries: results });
});

admin.route("/apps/:appId", appRoutes);

// ---- One org: /admin/orgs/:orgId/… -------------------------------------------

admin.use("/orgs/:orgId/*", orgScope);
admin.route("/orgs/:orgId/members", team);
admin.route("/orgs/:orgId/tokens", tokens);
admin.route("/orgs/:orgId", orgRoutes);

// ---- Unscoped (single org, single app) --------------------------------------

admin.use("/admins/*", implicitOrgScope);
admin.route("/admins", team);
admin.use("/tokens/*", implicitOrgScope);
admin.route("/tokens", tokens);
admin.use("/apps", implicitOrgScope);
admin.use("/audit", implicitOrgScope);
admin.route("/", orgRoutes);

for (const path of ["/updates/*", "/assets/*", "/channels", "/stats"]) {
  admin.use(path, implicitAppScope, requireWriteAccess);
}
admin.route("/", appRoutes);

export default admin;
