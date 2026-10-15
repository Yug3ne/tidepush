-- Dashboard accounts. Passwords are PBKDF2-SHA256 (see src/auth/password.ts).
-- Removed admins are disabled, not deleted, so the audit trail stays readable.
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at TEXT
);

-- Dashboard sessions. Only the sha256 of the cookie value is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX sessions_admin ON sessions (admin_id);

-- Bearer tokens for the CLI / CI (`tp_…`). Only the sha256 is stored; `prefix`
-- is the first 8 characters after `tp_`, for display.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  prefix TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- Single-use invite links. Only the sha256 of the token is stored.
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE INDEX invites_email ON invites (email);

-- Failed logins, for rate limiting by email and by IP.
CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  ip TEXT,
  at TEXT NOT NULL
);

CREATE INDEX login_failures_email ON login_failures (email, at);
CREATE INDEX login_failures_ip ON login_failures (ip, at);
