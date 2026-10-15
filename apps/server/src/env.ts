export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Must match updates.codeSigningMetadata.keyid in the app. */
  CODE_SIGNING_KEY_ID: string;
  /** Cloudflare Access team domain, e.g. "example.cloudflareaccess.com". Empty = Access off. */
  ACCESS_TEAM_DOMAIN: string;
  /** Cloudflare Access application AUD tag. Empty = Access off. */
  ACCESS_AUD: string;
  /** PEM (PKCS#1 or PKCS#8) RSA private key. Secret, required. */
  CODE_SIGNING_PRIVATE_KEY?: string;
  /** Long random string that unlocks first-run setup (creating the first owner). Secret. */
  SETUP_TOKEN?: string;
  /** Optional break-glass bearer tokens, comma-separated, >= 32 chars each. Secret. */
  ADMIN_API_TOKENS?: string;
}

export type Role = "owner" | "admin";

export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** How an /admin request authenticated. */
export type AuthVia = "session" | "token" | "env-token" | "access";

export interface AppVariables {
  /** Audit log actor: the admin's email, `token:<name>`, or `env-token`. */
  actor: string;
  /** The signed-in human, for session and Access auth. Null for API tokens. */
  admin: AdminIdentity | null;
  via: AuthVia;
  /** sha256 of the session cookie, for session auth. */
  sessionHash: string | null;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
