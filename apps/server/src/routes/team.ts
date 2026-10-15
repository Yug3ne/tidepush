import { Hono } from "hono";
import { z } from "zod";
import { requireOwner } from "../auth/middleware";
import { hashToken, randomToken } from "../auth/tokens";
import { auditStatement } from "../db";
import type { AppEnv, Role } from "../env";
import { HttpError, emailSchema, parseBody, requestOrigin, roleSchema } from "../lib/http";
import { INVITE_TTL_MS } from "./auth";

/** /admin/admins: the team (admins and pending invites). Owners only. */
const team = new Hono<AppEnv>();
team.use("*", requireOwner);

team.get("/", async (c) => {
  const db = c.env.DB;
  const [admins, invites] = await db.batch([
    db.prepare(
      `SELECT id, email, name, role, created_at, last_login_at, disabled_at FROM admins ORDER BY created_at`,
    ),
    db
      .prepare(
        `SELECT email, role, created_at, expires_at FROM invites
         WHERE accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
      )
      .bind(new Date().toISOString()),
  ]);
  type AdminRow = { id: string; email: string; name: string; role: Role; created_at: string; last_login_at: string | null; disabled_at: string | null };
  type InviteRow = { email: string; role: Role; created_at: string; expires_at: string };
  return c.json({
    admins: (admins!.results as AdminRow[]).map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      createdAt: a.created_at,
      lastLoginAt: a.last_login_at,
      disabled: a.disabled_at !== null,
    })),
    invites: (invites!.results as InviteRow[]).map((i) => ({
      email: i.email,
      role: i.role,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
  });
});

team.post("/invites", async (c) => {
  const db = c.env.DB;
  const { email, role } = await parseBody(c, z.object({ email: emailSchema, role: roleSchema }));
  const existing = await db
    .prepare(`SELECT 1 FROM admins WHERE email = ? AND disabled_at IS NULL`)
    .bind(email)
    .first();
  if (existing) throw new HttpError(409, "An admin with this email already exists");

  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const actor = c.get("actor");
  await db.batch([
    // A new invite replaces any pending one for the same email.
    db.prepare(`DELETE FROM invites WHERE email = ? AND accepted_at IS NULL`).bind(email),
    db
      .prepare(
        `INSERT INTO invites (token_hash, email, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(await hashToken(token), email, role, actor, now.toISOString(), expiresAt),
    auditStatement(db, { actor, action: "invite", target: email, details: { role, expiresAt } }),
  ]);
  return c.json({ inviteUrl: `${requestOrigin(c)}/invite/${token}`, expiresAt }, 201);
});

team.delete("/invites/:email", async (c) => {
  const db = c.env.DB;
  const email = c.req.param("email").trim().toLowerCase();
  const deleted = await db.prepare(`DELETE FROM invites WHERE email = ? AND accepted_at IS NULL`).bind(email).run();
  if (!deleted.meta.changes) throw new HttpError(404, "No pending invite for that email");
  await auditStatement(db, { actor: c.get("actor"), action: "invite_revoke", target: email }).run();
  return c.body(null, 204);
});

/** Removing an admin disables the account (keeping the audit trail) and ends their sessions. */
team.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (id === c.get("admin")!.id) throw new HttpError(400, "You cannot remove yourself");
  const target = await db
    .prepare(`SELECT id, email, role FROM admins WHERE id = ? AND disabled_at IS NULL`)
    .bind(id)
    .first<{ id: string; email: string; role: Role }>();
  if (!target) throw new HttpError(404, "Admin not found");

  // The owner check is part of the UPDATE, so concurrent removals can't leave zero owners.
  const disabled = await db
    .prepare(
      `UPDATE admins SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL
         AND (role != 'owner' OR (SELECT COUNT(*) FROM admins WHERE role = 'owner' AND disabled_at IS NULL) > 1)`,
    )
    .bind(new Date().toISOString(), id)
    .run();
  if (!disabled.meta.changes) throw new HttpError(409, "You cannot remove the last owner");
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE admin_id = ?`).bind(id),
    auditStatement(db, { actor: c.get("actor"), action: "admin_remove", target: target.email, details: { id, role: target.role } }),
  ]);
  return c.body(null, 204);
});

export default team;
