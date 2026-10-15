-- Multi-tenancy: organizations own apps and members; every update, asset,
-- device, token, invite and audit entry belongs to an org (and usually an app).
--
-- Existing data moves into one org (`org_default`) with one app
-- (`app_default`). Builds already in the field call /manifest and /assets/:key,
-- which keep resolving to `app_default` forever.
--
-- `devices`, `assets`, `update_assets` and `updates` are rebuilt because their
-- primary keys or foreign keys change (SQLite can't alter those in place).

PRAGMA defer_foreign_keys = true;

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'selfhost',
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

-- `id` is public: it's the path segment in an app's updates.url.
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs (id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX apps_org ON apps (org_id);

-- Who belongs to which org, and with what role. `admins` holds the people
-- (users); its `role` column is no longer read and will be dropped later.
CREATE TABLE memberships (
  org_id TEXT NOT NULL REFERENCES orgs (id),
  user_id TEXT NOT NULL REFERENCES admins (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX memberships_user ON memberships (user_id);

INSERT INTO orgs (id, slug, name, created_at) VALUES ('org_default', 'default', 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO apps (id, org_id, name, created_at) VALUES ('app_default', 'org_default', 'Default app', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO memberships (org_id, user_id, role, created_at)
SELECT 'org_default', id, role, created_at FROM admins WHERE disabled_at IS NULL;

-- ---- updates ----------------------------------------------------------------

CREATE TABLE updates_new (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message TEXT,
  git_sha TEXT,
  launch_asset_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  extra_json TEXT NOT NULL DEFAULT '{}',
  rollout_pct INTEGER NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rolled_back')),
  rolled_back_at TEXT,
  source_update_id TEXT,
  created_by TEXT
);

INSERT INTO updates_new (id, app_id, group_id, channel, platform, runtime_version, created_at, message, git_sha,
  launch_asset_key, metadata_json, extra_json, rollout_pct, status, rolled_back_at, source_update_id, created_by)
SELECT id, 'app_default', group_id, channel, platform, runtime_version, created_at, message, git_sha,
  launch_asset_key, metadata_json, extra_json, rollout_pct, status, rolled_back_at, source_update_id, created_by
FROM updates;

-- ---- assets (no more sharing between apps) ----------------------------------

CREATE TABLE assets_new (
  app_id TEXT NOT NULL,
  key TEXT NOT NULL,
  hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_ext TEXT,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, key)
);

INSERT INTO assets_new (app_id, key, hash, content_type, file_ext, r2_key, size, created_at)
SELECT 'app_default', key, hash, content_type, file_ext, r2_key, size, created_at FROM assets;

CREATE TABLE update_assets_new (
  update_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  PRIMARY KEY (update_id, asset_key)
);

INSERT INTO update_assets_new (update_id, asset_key) SELECT update_id, asset_key FROM update_assets;

-- ---- devices (a client id is unique per app, not globally) ------------------

CREATE TABLE devices_new (
  app_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  current_update_id TEXT,
  embedded_update_id TEXT,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (app_id, client_id)
);

INSERT INTO devices_new (app_id, client_id, platform, runtime_version, channel, current_update_id, embedded_update_id, last_seen)
SELECT 'app_default', client_id, platform, runtime_version, channel, current_update_id, embedded_update_id, last_seen FROM devices;

DROP TABLE update_assets;
DROP TABLE updates;
DROP TABLE assets;
DROP TABLE devices;

ALTER TABLE updates_new RENAME TO updates;
ALTER TABLE assets_new RENAME TO assets;
ALTER TABLE update_assets_new RENAME TO update_assets;
ALTER TABLE devices_new RENAME TO devices;

CREATE INDEX updates_lookup ON updates (app_id, channel, platform, runtime_version, created_at DESC);
CREATE INDEX updates_group ON updates (group_id);
CREATE INDEX updates_app_created ON updates (app_id, created_at DESC);
CREATE INDEX devices_current_update ON devices (app_id, current_update_id);
CREATE INDEX devices_last_seen ON devices (app_id, last_seen);

-- ---- tokens, invites, audit -------------------------------------------------

-- Tokens belong to an org; `app_id` optionally restricts one to a single app.
ALTER TABLE api_tokens ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org_default';
ALTER TABLE api_tokens ADD COLUMN app_id TEXT;

-- Rebuilt so invites can carry the new `member` role.
CREATE TABLE invites_new (
  token_hash TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
);

INSERT INTO invites_new (token_hash, org_id, email, role, created_by, created_at, expires_at, accepted_at)
SELECT token_hash, 'org_default', email, role, created_by, created_at, expires_at, accepted_at FROM invites;

DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX invites_email ON invites (org_id, email);

ALTER TABLE audit_log ADD COLUMN org_id TEXT;
ALTER TABLE audit_log ADD COLUMN app_id TEXT;
UPDATE audit_log SET org_id = 'org_default';
UPDATE audit_log SET app_id = 'app_default' WHERE action IN ('publish', 'promote', 'rollout', 'rollback');
CREATE INDEX audit_org ON audit_log (org_id, id DESC);
CREATE INDEX audit_app ON audit_log (app_id, id DESC);
