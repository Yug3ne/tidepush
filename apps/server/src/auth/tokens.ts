import type { Env } from "../env";
import { bytesToBase64Url, bytesToHex, sha256 } from "../lib/encoding";

/** 32 random bytes, base64url. Used for session cookies, invites and API tokens. */
export const randomToken = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** What the DB stores instead of a secret token: hex sha256. */
export const hashToken = async (token: string) => bytesToHex(await sha256(token));

export const API_TOKEN_PREFIX = "tp_";

/** A new `tp_…` API token, its hash and its display prefix (first 8 chars after `tp_`). */
export async function generateApiToken(): Promise<{ token: string; hash: string; prefix: string }> {
  const secret = randomToken();
  const token = `${API_TOKEN_PREFIX}${secret}`;
  return { token, hash: await hashToken(token), prefix: secret.slice(0, 8) };
}

export interface ApiTokenRow {
  id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  org_id: string;
  /** If set, the token can only act on this app. */
  app_id: string | null;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Looks up a non-revoked DB token and bumps `last_used_at` (at most every 5 min). */
export async function findApiToken(db: D1Database, token: string): Promise<ApiTokenRow | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const row = await db
    .prepare(`SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(await hashToken(token))
    .first<ApiTokenRow>();
  if (!row) return null;
  const now = Date.now();
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > TOUCH_INTERVAL_MS) {
    await db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).bind(new Date(now).toISOString(), row.id).run();
  }
  return row;
}

/**
 * Break-glass tokens from the ADMIN_API_TOKENS secret. Tokens shorter than 32
 * characters are ignored.
 */
export async function matchesEnvToken(token: string, env: Env): Promise<boolean> {
  if (!env.ADMIN_API_TOKENS) return false;
  const tokens = env.ADMIN_API_TOKENS.split(",")
    .map((t) => t.trim())
    .filter((t) => t.length >= 32);
  // Compare digests so lengths match and the comparison is constant-time.
  const given = await sha256(token);
  let ok = false;
  for (const t of tokens) {
    if (crypto.subtle.timingSafeEqual(given, await sha256(t))) ok = true;
  }
  return ok;
}

/** Constant-time string comparison (via digests, so lengths may differ). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));
}
