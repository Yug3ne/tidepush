import { Hono, type Context } from "hono";
import { z } from "zod";
import { hashPassword } from "../auth/password";
import { setPasswordStatement } from "../auth/credentials";
import { hashToken, safeEqual } from "../auth/tokens";
import { isHosted } from "../billing";
import { auditStatement } from "../db";
import type { AppEnv, Role } from "../env";
import { isInternal } from "../internal";
import { HttpError, emailSchema, nameSchema, parseBody, passwordSchema } from "../lib/http";
import { DEFAULT_ORG_ID } from "../tenancy";

/**
 * Account routes for the web app: first-run setup and invite links. They
 * answer only through the Internal entrypoint (the web app's service binding);
 * from the internet they don't exist. These routes create people and set
 * passwords; signing in is the web app's (Better Auth), against the same rows.
 */
const auth = new Hono<AppEnv>();

auth.use("*", async (c, next) => {
  if (!isInternal(c.req.raw)) throw new HttpError(404, "Not found");
  await next();
});

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

const adminCount = async (db: D1Database) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>())!.n;

// ---- Status -----------------------------------------------------------------

/** What the web app needs before anyone signs in: the mode, and whether first-run setup is pending. */
auth.get("/status", async (c) =>
  c.json({ mode: isHosted(c.env) ? "hosted" : "selfhost", needsSetup: (await adminCount(c.env.DB)) === 0 }),
);

// ---- First-run setup --------------------------------------------------------

/** Creates the first owner, of the default org. The web app then signs them in. */
auth.post("/setup", async (c) => {
  const db = c.env.DB;
  if ((await adminCount(db)) > 0) throw new HttpError(409, "Setup is already complete. Sign in instead.");
  if (!c.env.SETUP_TOKEN) {
    throw new HttpError(
      503,
      "Setup is disabled: set the SETUP_TOKEN secret on the API Worker (wrangler secret put SETUP_TOKEN), then try again.",
    );
  }
  const body = await parseBody(
    c,
    z.object({ setupToken: z.string().max(1024), email: emailSchema, name: nameSchema, password: passwordSchema }),
  );
  if (!(await safeEqual(body.setupToken, c.env.SETUP_TOKEN))) throw new HttpError(401, "Invalid setup token");

  const admin = { id: crypto.randomUUID(), email: body.email, name: body.name, role: "owner" as const };
  const now = new Date().toISOString();
  // Conditional inserts, so two racing setups can't both create an owner. The
  // first owner owns the default org, which self-hosted deployments use.
  const passwordHash = await hashPassword(body.password);
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO admins (id, email, name, email_verified, created_at, updated_at)
         SELECT ?1, ?2, ?3, 1, ?4, ?4 WHERE NOT EXISTS (SELECT 1 FROM admins)`,
      )
      .bind(admin.id, admin.email, admin.name, now),
    db
      .prepare(
        `INSERT INTO memberships (org_id, user_id, role, created_at)
         SELECT ?1, ?2, 'owner', ?3 WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = ?1)
           AND EXISTS (SELECT 1 FROM admins WHERE id = ?2)`,
      )
      .bind(DEFAULT_ORG_ID, admin.id, now),
  ]);
  if (!insert!.meta.changes) throw new HttpError(409, "Setup is already complete. Sign in instead.");
  await db.batch([
    setPasswordStatement(db, admin.id, passwordHash),
    auditStatement(db, { actor: admin.email, action: "setup", orgId: DEFAULT_ORG_ID, target: admin.id }),
  ]);
  return c.json({ admin }, 201);
});

// ---- Invites ----------------------------------------------------------------

interface InviteRow {
  token_hash: string;
  org_id: string;
  email: string;
  role: Role;
  created_by: string;
  expires_at: string;
  accepted_at: string | null;
}

async function usableInvite(c: Context<AppEnv>): Promise<InviteRow> {
  const invite = await c.env.DB.prepare(`SELECT * FROM invites WHERE token_hash = ?`)
    .bind(await hashToken(c.req.param("token") ?? ""))
    .first<InviteRow>();
  if (!invite) throw new HttpError(404, "Invite not found");
  if (invite.accepted_at) throw new HttpError(410, "This invite has already been used");
  if (Date.parse(invite.expires_at) <= Date.now()) throw new HttpError(410, "This invite has expired");
  return invite;
}

/** What an invite is for, and whether the invited email already has an account (then: sign in and accept). */
auth.get("/invites/:token", async (c) => {
  const invite = await usableInvite(c);
  const [org, account] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT name FROM orgs WHERE id = ?`).bind(invite.org_id),
    c.env.DB.prepare(`SELECT 1 FROM admins WHERE email = ? AND disabled_at IS NULL`).bind(invite.email),
  ]);
  return c.json({
    email: invite.email,
    role: invite.role,
    orgName: (org!.results[0] as { name: string } | undefined)?.name ?? null,
    expiresAt: invite.expires_at,
    hasAccount: account!.results.length > 0,
  });
});

/**
 * Accepts an invite for someone without an account: creates it for the
 * invited email, with the name and password they chose, and joins the org.
 * A person who was removed from every org gets their account back with the
 * new password. Someone who has an account signs in to the web app and
 * accepts there instead (POST /admin/invites/:token/accept).
 */
auth.post("/invites/:token/accept", async (c) => {
  const db = c.env.DB;
  const body = await parseBody(c, z.object({ name: nameSchema, password: passwordSchema }));
  const invite = await usableInvite(c);
  const existing = await db
    .prepare(`SELECT id, disabled_at FROM admins WHERE email = ?`)
    .bind(invite.email)
    .first<{ id: string; disabled_at: string | null }>();
  if (existing && !existing.disabled_at) {
    throw new HttpError(
      409,
      "An account with this email already exists. Sign in to it, then open the invite link again.",
    );
  }

  // Claim the invite first, so it can only be used once even under a race.
  const now = new Date().toISOString();
  const claimed = await db
    .prepare(`UPDATE invites SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL`)
    .bind(now, invite.token_hash)
    .run();
  if (!claimed.meta.changes) throw new HttpError(410, "This invite has already been used");

  const id = existing?.id ?? crypto.randomUUID();
  await db.batch([
    existing
      ? db
          .prepare(`UPDATE admins SET name = ?2, disabled_at = NULL, updated_at = ?3 WHERE id = ?1`)
          .bind(id, body.name, now)
      : db
          .prepare(
            `INSERT INTO admins (id, email, name, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
          )
          .bind(id, invite.email, body.name, now),
    setPasswordStatement(db, id, await hashPassword(body.password)),
    db
      .prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`)
      .bind(invite.org_id, id, invite.role, now),
    auditStatement(db, {
      actor: invite.email,
      action: "invite_accept",
      orgId: invite.org_id,
      target: id,
      details: { role: invite.role, invitedBy: invite.created_by },
    }),
  ]);
  return c.json({ orgId: invite.org_id, email: invite.email, role: invite.role }, 201);
});

export default auth;
