-- Code-signing keys, one or more per app. A build trusts one certificate and
-- asks for its key id (expo-expect-signature keyid=...), so several active
-- keys let old and new builds keep working during a rotation.
--
-- `private_key_enc` is the PKCS#8 key encrypted with AES-256-GCM under the
-- KEY_ENCRYPTION_KEY secret, with "<app_id>:<key_id>" as additional data so a
-- ciphertext can't be moved to another app or key id. Format: "v1.<iv>.<ciphertext>" (base64url).
--
-- The default app may have no row: it then keeps signing with the
-- CODE_SIGNING_PRIVATE_KEY secret, as before tenancy.
CREATE TABLE signing_keys (
  app_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  certificate_pem TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generated', 'uploaded')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY (app_id, key_id)
);
