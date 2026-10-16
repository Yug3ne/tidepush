-- Authentication tables for Better Auth (used by the web app), sharing people
-- with the admin API.
--
-- `admins` stays the table of people; Better Auth's `user` model maps onto it.
-- People who sign in with GitHub have no password, and the legacy `role`
-- column is superseded by memberships, so both columns go. Passwords move to
-- `auth_account` (provider `credential`), still PBKDF2, so nobody has to reset
-- theirs.

CREATE TABLE auth_account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- For `credential` this is the user id; for GitHub, the GitHub user id.
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  -- PBKDF2 hash (see src/auth/password.ts), for provider `credential` only.
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_id, account_id)
);

CREATE INDEX auth_account_user ON auth_account (user_id);

INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, id, 'credential', password_hash, created_at, created_at
FROM admins WHERE password_hash IS NOT NULL;

-- Dropped, not rebuilt: rebuilding `admins` would trip the foreign keys from
-- `sessions` and `memberships` (D1 enforces them).
ALTER TABLE admins DROP COLUMN password_hash;
ALTER TABLE admins DROP COLUMN role;
ALTER TABLE admins ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN image TEXT;
ALTER TABLE admins ADD COLUMN updated_at TEXT;

-- Everyone so far joined through first-run setup or an invite link sent to
-- their address, so their email counts as verified.
UPDATE admins SET email_verified = 1, updated_at = created_at;

-- Better Auth sessions for the web app. (`sessions` keeps serving the API's
-- own cookie, used by the self-hosted dashboard.)
CREATE TABLE auth_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX auth_session_user ON auth_session (user_id);

CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX auth_verification_identifier ON auth_verification (identifier);

-- OAuth 2.0 device authorization (RFC 8628), for `tidepush login`.
CREATE TABLE auth_device_code (
  id TEXT PRIMARY KEY,
  device_code TEXT UNIQUE NOT NULL,
  user_code TEXT UNIQUE NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  last_polled_at TEXT,
  polling_interval INTEGER,
  client_id TEXT,
  scope TEXT
);
