/**
 * Passwords live in `auth_account` (provider `credential`, account id = user
 * id), shared with Better Auth in the web app. The hash format is ours
 * (see password.ts) for both.
 */

export async function passwordHashOf(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT password FROM auth_account WHERE provider_id = 'credential' AND account_id = ?`)
    .bind(userId)
    .first<{ password: string | null }>();
  return row?.password ?? null;
}

/** Sets (or replaces) a person's password. */
export function setPasswordStatement(db: D1Database, userId: string, hash: string): D1PreparedStatement {
  const now = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?1, ?2, ?2, 'credential', ?3, ?4, ?4)
       ON CONFLICT (provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), userId, hash, now);
}

/** SQL for the person's password hash, for queries on `admins a`. */
export const PASSWORD_SQL = `(SELECT x.password FROM auth_account x WHERE x.provider_id = 'credential' AND x.account_id = a.id)`;
