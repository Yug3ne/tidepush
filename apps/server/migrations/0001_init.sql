-- Content-addressed assets, shared across updates. `key` is the hex sha256 of
-- the file, `hash` the base64url sha256 that expo-updates verifies.
CREATE TABLE assets (
  key TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_ext TEXT,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE updates (
  id TEXT PRIMARY KEY,
  -- All platform updates created by one publish/promote/republish share a group.
  group_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message TEXT,
  git_sha TEXT,
  launch_asset_key TEXT NOT NULL REFERENCES assets (key),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  extra_json TEXT NOT NULL DEFAULT '{}',
  rollout_pct INTEGER NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rolled_back')),
  rolled_back_at TEXT,
  -- Set when this update is a promotion or republish of another update.
  source_update_id TEXT,
  created_by TEXT
);

CREATE INDEX updates_lookup ON updates (channel, platform, runtime_version, created_at DESC);
CREATE INDEX updates_group ON updates (group_id);

CREATE TABLE update_assets (
  update_id TEXT NOT NULL REFERENCES updates (id),
  asset_key TEXT NOT NULL REFERENCES assets (key),
  PRIMARY KEY (update_id, asset_key)
);

CREATE TABLE devices (
  client_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  current_update_id TEXT,
  embedded_update_id TEXT,
  last_seen TEXT NOT NULL
);

CREATE INDEX devices_current_update ON devices (current_update_id);
CREATE INDEX devices_last_seen ON devices (last_seen);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details_json TEXT
);
