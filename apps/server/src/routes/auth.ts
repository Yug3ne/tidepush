import { Hono, type Context } from "hono";
import { z } from "zod";
import { dummyVerify, hashPassword, verifyPassword } from "../auth/password";
import { PRIMARY_ROLE_SQL } from "../auth/middleware";
import { clearSessionCookie, createSession, deleteSession, getSession, sessionCookie } from "../auth/session";
import { hashToken, safeEqual } from "../auth/tokens";
import { auditStatement } from "../db";
import type { AdminIdentity, AppEnv, Role } from "../env";
import {
  HttpError,
  emailSchema,
  isMutating,
  isSameOrigin,
  nameSchema,
  parseBody,
  passwordSchema,
} from "../lib/http";
import { DEFAULT_ORG_ID } from "../tenancy";

/**
 * Public account routes for the dashboard: first-run setup, login, logout and
 * invite acceptance. Everything else lives under /admin.
 */
const auth = new Hono<AppEnv>();

// Browsers always send Origin on POST. Refusing cross-origin posts here stops
// login CSRF (signing a victim into the attacker's account) and forced logout.
auth.use("*", async (c, next) => {
  if (isMutating(c.req.method) && c.req.header("origin") && !isSameOrigin(c)) {
    throw new HttpError(403, "Cross-origin request refused");
  }
  await next();
});

export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const INVALID_LOGIN = "Invalid email or password";

interface AdminRow extends Omit<AdminIdentity, "role"> {
  /** Role in the person's first org; null if they belong to none. */
  role: Role | null;
  password_hash: string;
  disabled_at: string | null;
}

const identity = (a: AdminIdentity): AdminIdentity => ({ id: a.id, email: a.email, name: a.name, role: a.role });

const findUser = (db: D1Database, email: string) =>
  db.prepare(`SELECT a.*, ${PRIMARY_ROLE_SQL} AS role FROM admins a WHERE a.email = ?`).bind(email).first<AdminRow>();

/** `admins.role` is legacy (owner|admin) and no longer read; keep it valid for its CHECK constraint. */
const legacyRole = (role: Role) => (role === "owner" ? "owner" : "admin");

const adminCount = async (db: D1Database) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>())!.n;

// ---- Status ---------------------------------------------------------------

auth.get("/status", async (c) => {
  const cookie = sessionCookie(c);
  const session = cookie ? await getSession(c.env.DB, cookie) : null;
  return c.json({ needsSetup: (await adminCount(c.env.DB)) === 0, admin: session ? session.admin : null });
});

// ---- First-run setup --------------------------------------------------------

auth.post("/setup", async (c) => {
  const db = c.env.DB;
  if ((await adminCount(db)) > 0) throw new HttpError(409, "Setup is already complete. Sign in instead.");
  if (!c.env.SETUP_TOKEN) {
    throw new HttpError(503, "Setup is disabled: set the SETUP_TOKEN secret on the Worker (wrangler secret put SETUP_TOKEN), then try again.");
  }
  const body = await parseBody(
    c,
    z.object({ setupToken: z.string().max(1024), email: emailSchema, name: nameSchema, password: passwordSchema }),
  );
  if (!(await safeEqual(body.setupToken, c.env.SETUP_TOKEN))) throw new HttpError(401, "Invalid setup token");

  const admin: AdminIdentity = { id: crypto.randomUUID(), email: body.email, name: body.name, role: "owner" };
  const now = new Date().toISOString();
  // Conditional inserts, so two racing setups can't both create an owner. The
  // first owner owns the default org, which self-hosted deployments use.
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO admins (id, email, name, password_hash, role, created_at, last_login_at)
         SELECT ?, ?, ?, ?, 'owner', ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)`,
      )
      .bind(admin.id, admin.email, admin.name, await hashPassword(body.password), now, now),
    db
      .prepare(
        `INSERT INTO memberships (org_id, user_id, role, created_at)
         SELECT ?1, ?2, 'owner', ?3 WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = ?1)
           AND EXISTS (SELECT 1 FROM admins WHERE id = ?2)`,
      )
      .bind(DEFAULT_ORG_ID, admin.id, now),
  ]);
  if (!insert!.meta.changes) throw new HttpError(409, "Setup is already complete. Sign in instead.");
  await auditStatement(db, { actor: admin.email, action: "setup", orgId: DEFAULT_ORG_ID, target: admin.id }).run();
  await createSession(c, admin.id);
  return c.json({ admin }, 201);
});

// ---- Login / logout ---------------------------------------------------------

auth.post("/login", async (c) => {
  const db = c.env.DB;
  const body = await parseBody(c, z.object({ email: z.string().max(254), password: z.string().max(1024) }));
  const email = body.email.trim().toLowerCase();
  const ip = c.req.header("cf-connecting-ip") ?? null;
  await checkRateLimit(c, email, ip);

  const row = await findUser(db, email);
  const ok = row ? await verifyPassword(body.password, row.password_hash) : await dummyVerify(body.password);
  // Someone in no org can't do anything, so they can't sign in either.
  if (!row || !ok || row.disabled_at || !row.role) {
    await db.batch([
      db.prepare(`INSERT INTO login_failures (email, ip, at) VALUES (?, ?, ?)`).bind(email, ip, new Date().toISOString()),
      // Keep the table small: nothing older than a day matters.
      db.prepare(`DELETE FROM login_failures WHERE at < ?`).bind(new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    throw new HttpError(401, INVALID_LOGIN);
  }

  await db.batch([
    db.prepare(`DELETE FROM login_failures WHERE email = ?`).bind(email),
    db.prepare(`UPDATE admins SET last_login_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id),
    auditStatement(db, { actor: row.email, action: "login", orgId: null, target: row.id, details: { ip } }),
  ]);
  await createSession(c, row.id);
  return c.json({ admin: identity({ ...row, role: row.role }) });
});

async function checkRateLimit(c: Context<AppEnv>, email: string, ip: string | null): Promise<void> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const count = (column: "email" | "ip", value: string) =>
    c.env.DB.prepare(`SELECT COUNT(*) AS n, MIN(at) AS oldest FROM login_failures WHERE ${column} = ? AND at > ?`)
      .bind(value, since)
      .first<{ n: number; oldest: string | null }>();
  const checks = [
    { result: await count("email", email), max: MAX_FAILURES_PER_EMAIL },
    ...(ip ? [{ result: await count("ip", ip), max: MAX_FAILURES_PER_IP }] : []),
  ];
  for (const { result, max } of checks) {
    if (result && result.n >= max && result.oldest) {
      const retryAfter = Math.max(1, Math.ceil((Date.parse(result.oldest) + RATE_WINDOW_MS - Date.now()) / 1000));
      throw new HttpError(429, "Too many failed sign-in attempts. Try again later.", {
        "retry-after": String(retryAfter),
      });
    }
  }
}

auth.post("/logout", async (c) => {
  const cookie = sessionCookie(c);
  if (cookie) {
    const session = await getSession(c.env.DB, cookie);
    if (session) {
      await deleteSession(c.env.DB, session.tokenHash);
      await auditStatement(c.env.DB, {
        actor: session.admin.email,
        action: "logout",
        orgId: null,
        target: session.admin.id,
      }).run();
    }
  }
  clearSessionCookie(c);
  return c.body(null, 204);
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

auth.get("/invites/:token", async (c) => {
  const invite = await usableInvite(c);
  return c.json({ email: invite.email, role: invite.role, expiresAt: invite.expires_at });
});

/**
 * Accepts an invite. A new person sets their name and password. Someone who
 * already has an account must be signed in as that account, and just joins
 * the org. A person who was removed from every org gets their account back
 * with a fresh password.
 */
auth.post("/invites/:token/accept", async (c) => {
  const db = c.env.DB;
  const body = await parseBody(c, z.object({ name: nameSchema.optional(), password: passwordSchema.optional() }));
  const invite = await usableInvite(c);
  const existing = await findUser(db, invite.email);
  const active = existing && !existing.disabled_at ? existing : null;

  if (active) {
    const cookie = sessionCookie(c);
    const session = cookie ? await getSession(db, cookie) : null;
    if (session?.admin.id !== active.id) {
      throw new HttpError(409, "An account with this email already exists. Sign in to it, then open the invite link again.");
    }
    const member = await db
      .prepare(`SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?`)
      .bind(invite.org_id, active.id)
      .first();
    if (member) throw new HttpError(409, "You are already a member of this organization");
  } else if (!body.name || !body.password) {
    throw new HttpError(400, "name and password are required");
  }

  // Claim the invite first, so it can only be used once even under a race.
  const now = new Date().toISOString();
  const claimed = await db
    .prepare(`UPDATE invites SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL`)
    .bind(now, invite.token_hash)
    .run();
  if (!claimed.meta.changes) throw new HttpError(410, "This invite has already been used");

  const admin: AdminIdentity = {
    id: existing?.id ?? crypto.randomUUID(),
    email: invite.email,
    name: active ? active.name : body.name!,
    role: invite.role,
  };
  const statements: D1PreparedStatement[] = [];
  if (!active) {
    const passwordHash = await hashPassword(body.password!);
    statements.push(
      existing
        ? db
            .prepare(
              `UPDATE admins SET name = ?, password_hash = ?, disabled_at = NULL, last_login_at = ? WHERE id = ?`,
            )
            .bind(admin.name, passwordHash, now, admin.id)
        : db
            .prepare(
              `INSERT INTO admins (id, email, name, password_hash, role, created_at, last_login_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(admin.id, admin.email, admin.name, passwordHash, legacyRole(invite.role), now, now),
    );
  }
  statements.push(
    db
      .prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`)
      .bind(invite.org_id, admin.id, invite.role, now),
    auditStatement(db, {
      actor: admin.email,
      action: "invite_accept",
      orgId: invite.org_id,
      target: admin.id,
      details: { role: admin.role, invitedBy: invite.created_by },
    }),
  );
  await db.batch(statements);
  if (!active) await createSession(c, admin.id);
  return c.json({ admin }, 201);
});

export default auth;
