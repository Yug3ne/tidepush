-- Build-time variables for an app (EXPO_PUBLIC_*), kept on the server so every
-- publish bundles the same values whoever runs it. `tidepush publish` fetches
-- them and passes them to `expo export`.
--
-- `channel` is '' for a value that applies to every channel; a value set for
-- one channel wins over it.
--
-- `value_enc` is the value encrypted with AES-256-GCM under a key derived from
-- the KEY_ENCRYPTION_KEY secret, with the app, channel and name as additional
-- data, so a ciphertext can't be moved to another app, channel or name.
-- Format: "v1.<iv>.<ciphertext>" (base64url). Plain values are never stored.
CREATE TABLE app_env_vars (
  app_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, channel, name)
);
