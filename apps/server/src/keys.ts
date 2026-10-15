import type { Env } from "./env";
import { base64ToBytes, bytesToBase64Url } from "./lib/encoding";
import { HttpError } from "./lib/http";
import { generateCodeSigningKey } from "./protocol/certificate";
import { ALGORITHM, importPrivateKey } from "./protocol/sign";
import { DEFAULT_APP_ID } from "./tenancy";

/**
 * Per-app code-signing keys: encryption at rest, storage, and a per-isolate
 * cache of imported keys for the manifest path.
 */

export const KEY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
export const DEFAULT_KEY_ID = "main";

export interface SigningKeyRow {
  app_id: string;
  key_id: string;
  private_key_enc: string;
  certificate_pem: string;
  source: "generated" | "uploaded";
  created_by: string;
  created_at: string;
  retired_at: string | null;
}

// ---- Encryption at rest -------------------------------------------------------

let kekCache: { secret: string; key: Promise<CryptoKey> } | undefined;

/** The AES-256-GCM key-encryption key, or null if KEY_ENCRYPTION_KEY isn't set. */
export function keyEncryptionKey(env: Env): Promise<CryptoKey> | null {
  const secret = env.KEY_ENCRYPTION_KEY;
  if (!secret) return null;
  if (kekCache?.secret !== secret) {
    const raw = base64ToBytes(secret.trim());
    if (raw.length !== 32) throw new Error("KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    kekCache = { secret, key: crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) };
  }
  return kekCache.key;
}

const additionalData = (appId: string, keyId: string) => new TextEncoder().encode(`${appId}:${keyId}`);

export async function encryptPrivateKey(kek: CryptoKey, pkcs8: Uint8Array, appId: string, keyId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(appId, keyId) }, kek, pkcs8);
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ct))}`;
}

export async function decryptPrivateKey(kek: CryptoKey, enc: string, appId: string, keyId: string): Promise<Uint8Array> {
  const [version, iv, ct] = enc.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unknown private key encoding");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: additionalData(appId, keyId) },
    kek,
    base64ToBytes(ct),
  );
  return new Uint8Array(plain);
}

export function requireKek(env: Env): Promise<CryptoKey> {
  const kek = keyEncryptionKey(env);
  if (!kek) {
    throw new HttpError(
      503,
      "Per-app signing keys are disabled: set the KEY_ENCRYPTION_KEY secret (32 random bytes, base64) on the Worker.",
    );
  }
  return kek;
}

// ---- Creating keys ------------------------------------------------------------

/** Statement storing a new generated key; returns the certificate to give the app. */
export async function generatedKeyStatement(
  env: Env,
  kek: CryptoKey,
  opts: { appId: string; keyId: string; appName: string; actor: string },
): Promise<{ statement: D1PreparedStatement; certificatePem: string }> {
  const { pkcs8, certificatePem } = await generateCodeSigningKey(opts.appName);
  return {
    statement: storeKeyStatement(env.DB, {
      appId: opts.appId,
      keyId: opts.keyId,
      enc: await encryptPrivateKey(kek, pkcs8, opts.appId, opts.keyId),
      certificatePem,
      source: "generated",
      actor: opts.actor,
    }),
    certificatePem,
  };
}

export function storeKeyStatement(
  db: D1Database,
  k: { appId: string; keyId: string; enc: string; certificatePem: string; source: SigningKeyRow["source"]; actor: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO signing_keys (app_id, key_id, private_key_enc, certificate_pem, source, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(k.appId, k.keyId, k.enc, k.certificatePem, k.source, k.actor, new Date().toISOString());
}

// ---- Signing ------------------------------------------------------------------

// Imported keys per isolate, briefly, so retiring or replacing a key takes effect within a minute.
const SIGNER_TTL_MS = 60_000;
const signers = new Map<string, { at: number; key: Promise<CryptoKey | null> }>();

export function forgetSigner(appId: string, keyId: string) {
  signers.delete(`${appId}:${keyId}`);
}

/**
 * The key that signs responses for `appId` when a build asks for `keyId`, or
 * null if the app has no active key with that id. The default app falls back
 * to the CODE_SIGNING_PRIVATE_KEY secret (matching CODE_SIGNING_KEY_ID), which
 * is how every deployment signed before per-app keys.
 */
export function signerFor(env: Env, appId: string, keyId: string): Promise<CryptoKey | null> {
  const cacheKey = `${appId}:${keyId}`;
  const hit = signers.get(cacheKey);
  if (hit && Date.now() - hit.at < SIGNER_TTL_MS) return hit.key;
  const key = loadSigner(env, appId, keyId);
  signers.set(cacheKey, { at: Date.now(), key });
  key.catch(() => signers.delete(cacheKey));
  return key;
}

async function loadSigner(env: Env, appId: string, keyId: string): Promise<CryptoKey | null> {
  const row = await env.DB.prepare(
    `SELECT private_key_enc FROM signing_keys WHERE app_id = ? AND key_id = ? AND retired_at IS NULL`,
  )
    .bind(appId, keyId)
    .first<{ private_key_enc: string }>();
  if (row) {
    const kek = keyEncryptionKey(env);
    if (!kek) throw new Error(`App ${appId} has a signing key but KEY_ENCRYPTION_KEY is not set`);
    const pkcs8 = await decryptPrivateKey(await kek, row.private_key_enc, appId, keyId);
    return crypto.subtle.importKey("pkcs8", pkcs8, ALGORITHM, false, ["sign"]);
  }
  if (appId === DEFAULT_APP_ID && env.CODE_SIGNING_PRIVATE_KEY && keyId === env.CODE_SIGNING_KEY_ID) {
    return importPrivateKey(env.CODE_SIGNING_PRIVATE_KEY);
  }
  return null;
}
