export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /**
   * "hosted" applies plan limits to orgs that aren't subscribed and lets anyone
   * who signs up create an org. Anything else (the default) is a self-hosted
   * deployment: no limits.
   */
  TIDEPUSH_MODE?: string;
  /** Must match updates.codeSigningMetadata.keyid in the app. */
  CODE_SIGNING_KEY_ID: string;
  /** PEM (PKCS#1 or PKCS#8) RSA private key. Secret, required. */
  CODE_SIGNING_PRIVATE_KEY?: string;
  /**
   * 32 random bytes, base64. Encrypts each app's code-signing private key at
   * rest. Secret. Without it, apps can't get their own keys, and only the
   * default app can sign (with CODE_SIGNING_PRIVATE_KEY).
   */
  KEY_ENCRYPTION_KEY?: string;
  /** Cloudflare Email Service binding; used only when EMAIL_FROM is set (see email.ts). */
  EMAIL?: import("./email").EmailBinding;
  /** Sender for invites and plan warnings, e.g. "Tidepush <no-reply@tidepush.dev>". Empty = don't send email. */
  EMAIL_FROM?: string;
  /**
   * The web app's public URL: links in emails (invites, plan warnings), and
   * where `/` redirects. Empty = invite links use the URL the web app reports.
   */
  WEB_URL?: string;
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
export type AuthVia = "token" | "env-token" | "internal";

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
  /** The signed-in person the web app acts for. Null for API tokens. */
  admin: AdminIdentity | null;
  via: AuthVia;
  /** Set by the org/app scope middleware. */
  orgId: string;
  role: Role;
  /** Set by the app scope middleware. */
  app: ScopedApp;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
