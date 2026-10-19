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
import { isHosted } from "../billing";
import { hashToken } from "../auth/tokens";
import { auditStatement } from "../db";
import type { AppEnv, Role } from "../env";
import { HttpError, nameSchema, parseBody } from "../lib/http";
import { newOrgId } from "../tenancy";
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

// ---- Organizations and invites, for a signed-in person -----------------------

/**
 * Creates an org with the caller as its owner. Hosted mode only: a self-hosted
 * deployment has one org, created at first-run setup.
 */
admin.post("/orgs", async (c) => {
  const principal = c.get("principal");
  if (principal.kind !== "user") throw new HttpError(403, "Sign in to create an organization");
  if (!isHosted(c.env)) throw new HttpError(403, "This server has a single organization");
  const { name } = await parseBody(c, z.object({ name: nameSchema }));
  const id = newOrgId();
  const slug = `${slugify(name)}-${id.slice(4, 10)}`;
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO orgs (id, slug, name, plan, created_at) VALUES (?, ?, ?, 'free', ?)`).bind(id, slug, name, now),
    c.env.DB.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(
      id,
      principal.user.id,
      now,
    ),
    auditStatement(c.env.DB, { actor: c.get("actor"), action: "org_create", orgId: id, target: id, details: { name } }),
  ]);
  return c.json({ id, slug, name, role: "owner" }, 201);
});

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";

interface InviteRow {
  token_hash: string;
  org_id: string;
  org_name: string;
  email: string;
  role: Role;
  created_by: string;
  expires_at: string;
  accepted_at: string | null;
}

async function usableInvite(db: D1Database, token: string): Promise<InviteRow> {
  const invite = await db
    .prepare(`SELECT i.*, o.name AS org_name FROM invites i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ?`)
    .bind(await hashToken(token))
    .first<InviteRow>();
  if (!invite) throw new HttpError(404, "Invite not found");
  if (invite.accepted_at) throw new HttpError(410, "This invite has already been used");
  if (Date.parse(invite.expires_at) <= Date.now()) throw new HttpError(410, "This invite has expired");
  return invite;
}

/** Joins the org an invite is for. The invite must be addressed to the signed-in person's email. */
admin.post("/invites/:token/accept", async (c) => {
  const principal = c.get("principal");
  if (principal.kind !== "user") throw new HttpError(403, "Sign in to accept an invite");
  const db = c.env.DB;
  const invite = await usableInvite(db, c.req.param("token"));
  if (invite.email !== principal.user.email.toLowerCase()) {
    throw new HttpError(403, `This invite is for ${invite.email}. Sign in with that email to accept it.`);
  }
  const member = await db
    .prepare(`SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?`)
    .bind(invite.org_id, principal.user.id)
    .first();
  if (member) throw new HttpError(409, "You are already a member of this organization");

  const now = new Date().toISOString();
  const claimed = await db
    .prepare(`UPDATE invites SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL`)
    .bind(now, invite.token_hash)
    .run();
  if (!claimed.meta.changes) throw new HttpError(410, "This invite has already been used");
  await db.batch([
    db
      .prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`)
      .bind(invite.org_id, principal.user.id, invite.role, now),
    auditStatement(db, {
      actor: c.get("actor"),
      action: "invite_accept",
      orgId: invite.org_id,
      target: principal.user.id,
      details: { role: invite.role, invitedBy: invite.created_by },
    }),
  ]);
  return c.json({ orgId: invite.org_id, orgName: invite.org_name, role: invite.role }, 201);
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
admin.use("/usage", implicitOrgScope);
admin.route("/", orgRoutes);

for (const path of ["/updates/*", "/assets/*", "/channels", "/stats", "/keys/*"]) {
  admin.use(path, implicitAppScope, requireWriteAccess);
}
admin.route("/", appRoutes);

export default admin;
