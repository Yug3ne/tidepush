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

/** A role within one organization. */
export type Role = "owner" | "admin" | "member";

/** A person who can sign in. `role` is their role in the org the request is about (or their only org). */
export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface UserIdentity {
  id: string;
  email: string;
  name: string;
}

/** How an /admin request authenticated. */
export type AuthVia = "session" | "token" | "env-token" | "access";

/**
 * Who is calling. People are checked against memberships per org; tokens
 * belong to exactly one org and may be restricted to one app.
 */
export type Principal =
  | { kind: "user"; user: UserIdentity }
  | { kind: "token"; tokenId: string; name: string; orgId: string; appId: string | null }
  | { kind: "env-token"; orgId: string };

export interface ScopedApp {
  id: string;
  orgId: string;
  name: string;
}

export interface AppVariables {
  /** Audit log actor: the person's email, `token:<name>`, or `env-token`. */
  actor: string;
  principal: Principal;
  /** The signed-in human, for session and Access auth. Null for API tokens. */
  admin: AdminIdentity | null;
  via: AuthVia;
  /** sha256 of the session cookie, for session auth. */
  sessionHash: string | null;
  /** Set by the org/app scope middleware. */
  orgId: string;
  role: Role;
  /** Set by the app scope middleware. */
  app: ScopedApp;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
