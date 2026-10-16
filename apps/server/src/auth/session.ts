import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AdminIdentity } from "../env";
import { hashToken, randomToken } from "./tokens";

/**
 * Dashboard sessions. The cookie holds 32 random bytes; the DB holds only their
 * sha256. Sessions last 7 days at most and end after 24h without use.
 */
export const SESSION_COOKIE = "__Host-tidepush_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function createSession(c: Context, adminId: string): Promise<void> {
  const token = randomToken();
  const now = new Date();
  await c.env.DB.prepare(
    `INSERT INTO sessions (token_hash, admin_id, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await hashToken(token),
      adminId,
      now.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      now.toISOString(),
      c.req.header("user-agent")?.slice(0, 512) ?? null,
      c.req.header("cf-connecting-ip") ?? null,
    )
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", httpOnly: true, secure: true, sameSite: "Strict" });
}

export const sessionCookie = (c: Context): string | undefined => getCookie(c, SESSION_COOKIE) || undefined;

interface SessionRow {
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  id: string;
  email: string;
  name: string;
  /** Role in the person's first org; null if they belong to none. */
  role: AdminIdentity["role"] | null;
}

/**
 * Resolves a session cookie to its admin. Expired, idle or orphaned sessions
 * (disabled admin) are deleted and yield null. Bumps `last_seen_at` at most
 * every 5 minutes.
 */
export async function getSession(
  db: D1Database,
  token: string,
): Promise<{ admin: AdminIdentity; tokenHash: string } | null> {
  const tokenHash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT s.token_hash, s.expires_at, s.last_seen_at, a.id, a.email, a.name, a.disabled_at,
         (SELECT m.role FROM memberships m WHERE m.user_id = a.id ORDER BY m.created_at LIMIT 1) AS role
       FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionRow & { disabled_at: string | null }>();
  if (!row) return null;

  const now = Date.now();
  if (row.disabled_at || Date.parse(row.expires_at) <= now || now - Date.parse(row.last_seen_at) > SESSION_IDLE_MS) {
    await deleteSession(db, tokenHash);
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    await db
      .prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`)
      .bind(new Date(now).toISOString(), tokenHash)
      .run();
  }
  // Nobody without an org can do anything; treat it like an ended session.
  if (!row.role) return null;
  return { admin: { id: row.id, email: row.email, name: row.name, role: row.role }, tokenHash };
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
}
