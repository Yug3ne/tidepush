import type { PendingInvite, TeamAdmin } from "@tidepush/api";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireOwner } from "../auth/middleware";
import { hashToken, randomToken } from "../auth/tokens";
import { assertCanInvite, isHosted } from "../billing";
import { auditStatement } from "../db";
import { sendEmail } from "../email";
import type { AppEnv, Role } from "../env";
import { internalWebUrlOf } from "../internal";
import { HttpError, emailSchema, parseBody, requestOrigin, roleSchema } from "../lib/http";
import { INVITE_TTL_MS } from "./auth";

/**
 * Members of one org, and pending invites. Owners only. Mounted at
 * /admin/orgs/:orgId/members and (for single-org callers) /admin/admins.
 */
const team = new Hono<AppEnv>();
team.use("*", requireOwner);

const audit = (c: Context<AppEnv>, entry: { action: string; target?: string; details?: unknown }) =>
  auditStatement(c.env.DB, { ...entry, actor: c.get("actor"), orgId: c.get("orgId") });

team.get("/", async (c) => {
  const db = c.env.DB;
  const orgId = c.get("orgId");
  const [members, invites] = await db.batch([
    db
      .prepare(
        `SELECT a.id, a.email, a.name, m.role, m.created_at, a.last_login_at
         FROM memberships m JOIN admins a ON a.id = m.user_id
         WHERE m.org_id = ? ORDER BY m.created_at`,
      )
      .bind(orgId),
    db
      .prepare(
        `SELECT email, role, created_at, expires_at FROM invites
         WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
      )
      .bind(orgId, new Date().toISOString()),
  ]);
  type MemberRow = {
    id: string;
    email: string;
    name: string;
    role: Role;
    created_at: string;
    last_login_at: string | null;
  };
  type InviteRow = { email: string; role: Role; created_at: string; expires_at: string };
  return c.json({
    admins: (members!.results as MemberRow[]).map(
      (m): TeamAdmin => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        createdAt: m.created_at,
        lastLoginAt: m.last_login_at,
        disabled: false,
      }),
    ),
    invites: (invites!.results as InviteRow[]).map(
      (i): PendingInvite => ({
        email: i.email,
        role: i.role,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
      }),
    ),
  });
});

team.post("/invites", async (c) => {
  const db = c.env.DB;
  const orgId = c.get("orgId");
  const { email, role } = await parseBody(c, z.object({ email: emailSchema, role: roleSchema }));
  const existing = await db
    .prepare(
      `SELECT 1 FROM memberships m JOIN admins a ON a.id = m.user_id
       WHERE m.org_id = ? AND a.email = ? AND a.disabled_at IS NULL`,
    )
    .bind(orgId, email)
    .first();
  if (existing) throw new HttpError(409, "This person is already a member");
  await assertCanInvite(c.env, orgId);

  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  await db.batch([
    // A new invite replaces any pending one for the same email in this org.
    db.prepare(`DELETE FROM invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL`).bind(orgId, email),
    db
      .prepare(
        `INSERT INTO invites (token_hash, org_id, email, role, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(await hashToken(token), orgId, email, role, c.get("actor"), now.toISOString(), expiresAt),
    audit(c, { action: "invite", target: email, details: { role, expiresAt } }),
  ]);
  // Invites are accepted in the web app: WEB_URL, else the URL the web app reported for itself.
  const webUrl = c.env.WEB_URL || internalWebUrlOf(c.req.raw) || requestOrigin(c);
  const inviteUrl = `${webUrl.replace(/\/$/, "")}/invite/${token}`;
  const org = await db.prepare(`SELECT name FROM orgs WHERE id = ?`).bind(orgId).first<{ name: string }>();
  const emailed = await sendEmail(c.env, {
    to: email,
    subject: `You're invited to ${org?.name ?? "an organization"} on Tidepush`,
    lines: [
      `${c.get("admin")?.name ?? "Someone"} invited you to ${org?.name ?? "their organization"} on Tidepush, as ${role}.`,
      "The link works once and expires in 72 hours.",
    ],
    action: { label: "Accept the invite", url: inviteUrl },
  });
  return c.json({ inviteUrl, token, expiresAt, emailed }, 201);
});

team.delete("/invites/:email", async (c) => {
  const db = c.env.DB;
  const email = c.req.param("email").trim().toLowerCase();
  const deleted = await db
    .prepare(`DELETE FROM invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL`)
    .bind(c.get("orgId"), email)
    .run();
  if (!deleted.meta.changes) throw new HttpError(404, "No pending invite for that email");
  await audit(c, { action: "invite_revoke", target: email }).run();
  return c.body(null, 204);
});

async function member(c: Context<AppEnv>, userId: string) {
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.email, m.role FROM memberships m JOIN admins a ON a.id = m.user_id
     WHERE m.org_id = ? AND m.user_id = ?`,
  )
    .bind(c.get("orgId"), userId)
    .first<{ id: string; email: string; role: Role }>();
  if (!row) throw new HttpError(404, "Member not found");
  return row;
}

// The owner checks are part of each UPDATE/DELETE, so concurrent changes can't leave an org with no owner.
const OTHER_OWNERS = `(SELECT COUNT(*) FROM memberships WHERE org_id = ?1 AND role = 'owner') > 1`;

/** Changes a member's role. The last owner can't be demoted. */
team.patch("/:id", async (c) => {
  const db = c.env.DB;
  const orgId = c.get("orgId");
  const { role } = await parseBody(c, z.object({ role: roleSchema }));
  const target = await member(c, c.req.param("id"));
  const changed = await db
    .prepare(
      `UPDATE memberships SET role = ?3 WHERE org_id = ?1 AND user_id = ?2
         AND (role != 'owner' OR ?3 = 'owner' OR ${OTHER_OWNERS})`,
    )
    .bind(orgId, target.id, role)
    .run();
  if (!changed.meta.changes) throw new HttpError(409, "An organization needs at least one owner");
  await audit(c, {
    action: "role_change",
    target: target.email,
    details: { id: target.id, from: target.role, to: role },
  }).run();
  return c.json({ id: target.id, role });
});

/**
 * Removes someone from the org. They lose access to it at once (every request
 * checks membership). On a self-hosted server, people left in no org are also
 * disabled (keeping the audit trail readable) and signed out everywhere; on
 * the hosted service they keep their account, which they created themselves.
 */
team.delete("/:id", async (c) => {
  const db = c.env.DB;
  const orgId = c.get("orgId");
  const id = c.req.param("id");
  if (id === c.get("admin")!.id) throw new HttpError(400, "You cannot remove yourself");
  const target = await member(c, id);

  const removed = await db
    .prepare(`DELETE FROM memberships WHERE org_id = ?1 AND user_id = ?2 AND (role != 'owner' OR ${OTHER_OWNERS})`)
    .bind(orgId, id)
    .run();
  if (!removed.meta.changes) throw new HttpError(409, "You cannot remove the last owner");

  const now = new Date().toISOString();
  const orphaned = `NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?1)`;
  await db.batch([
    ...(isHosted(c.env)
      ? []
      : [
          db
            .prepare(`UPDATE admins SET disabled_at = ?2 WHERE id = ?1 AND disabled_at IS NULL AND ${orphaned}`)
            .bind(id, now),
          db.prepare(`DELETE FROM auth_session WHERE user_id = ?1 AND ${orphaned}`).bind(id),
        ]),
    audit(c, { action: "admin_remove", target: target.email, details: { id, role: target.role } }),
  ]);
  return c.body(null, 204);
});

export default team;
