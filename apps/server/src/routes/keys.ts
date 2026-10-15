import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { requireHuman } from "../auth/middleware";
import { verifyPassword } from "../auth/password";
import { auditStatement } from "../db";
import type { AppEnv } from "../env";
import { HttpError, parseBody } from "../lib/http";
import {
  DEFAULT_KEY_ID,
  KEY_ID,
  decryptPrivateKey,
  encryptPrivateKey,
  forgetSigner,
  generatedKeyStatement,
  requireKek,
  storeKeyStatement,
  type SigningKeyRow,
} from "../keys";
import { ALGORITHM, pemToPkcs8 } from "../protocol/sign";
import { certificateFingerprint, keyMatchesCertificate, pemEncode } from "../protocol/certificate";
import { DEFAULT_APP_ID } from "../tenancy";

/**
 * An app's code-signing keys: /admin/apps/:appId/keys. Anyone in the org can
 * list keys and download certificates (they are public). Creating, uploading,
 * exporting and retiring keys is for owners, signed in.
 */
const keys = new Hono<AppEnv>();

const requireSignedInOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("role") !== "owner") throw new HttpError(403, "Only owners can manage signing keys");
  await next();
});

const audit = (c: Context<AppEnv>, entry: { action: string; target?: string; details?: unknown }) =>
  auditStatement(c.env.DB, { ...entry, actor: c.get("actor"), orgId: c.get("orgId"), appId: c.get("app").id });

const keyIdSchema = z.string().regex(KEY_ID, "key ids are letters, digits, '.', '_' and '-', up to 64 characters");

async function serialize(k: Pick<SigningKeyRow, "key_id" | "certificate_pem" | "source" | "created_at" | "retired_at">) {
  return {
    keyId: k.key_id,
    source: k.source,
    createdAt: k.created_at,
    retired: k.retired_at !== null,
    retiredAt: k.retired_at,
    certificatePem: k.certificate_pem,
    fingerprint: await certificateFingerprint(k.certificate_pem),
  };
}

keys.get("/", async (c) => {
  const app = c.get("app");
  const { results } = await c.env.DB.prepare(
    `SELECT key_id, certificate_pem, source, created_at, retired_at FROM signing_keys
     WHERE app_id = ? ORDER BY retired_at IS NOT NULL, created_at`,
  )
    .bind(app.id)
    .all<SigningKeyRow>();
  const list = await Promise.all(results.map(serialize));
  // The default app may still sign with the deployment's CODE_SIGNING_PRIVATE_KEY secret.
  const environmentKey =
    app.id === DEFAULT_APP_ID && c.env.CODE_SIGNING_PRIVATE_KEY && !results.some((k) => k.key_id === c.env.CODE_SIGNING_KEY_ID)
      ? { keyId: c.env.CODE_SIGNING_KEY_ID, source: "environment" as const }
      : null;
  return c.json({ keys: list, environmentKey });
});

keys.get("/:keyId/certificate", async (c) => {
  const row = await c.env.DB.prepare(`SELECT certificate_pem FROM signing_keys WHERE app_id = ? AND key_id = ?`)
    .bind(c.get("app").id, c.req.param("keyId"))
    .first<{ certificate_pem: string }>();
  if (!row) throw new HttpError(404, "Signing key not found");
  return c.body(row.certificate_pem, 200, {
    "content-type": "application/x-pem-file",
    "content-disposition": `attachment; filename="certificate.pem"`,
  });
});

/** Generates a new key pair (for a new app, or to rotate). */
keys.post("/", requireHuman, requireSignedInOwner, async (c) => {
  const { keyId } = await parseBody(c, z.object({ keyId: keyIdSchema.default(DEFAULT_KEY_ID) }));
  const app = c.get("app");
  const kek = await requireKek(c.env);
  await assertUnusedKeyId(c, keyId);
  const { statement, certificatePem } = await generatedKeyStatement(c.env, kek, {
    appId: app.id,
    keyId,
    appName: app.name,
    actor: c.get("actor"),
  });
  await c.env.DB.batch([statement, audit(c, { action: "key_create", target: keyId, details: { source: "generated" } })]);
  forgetSigner(app.id, keyId);
  return c.json({ keyId, certificatePem, fingerprint: await certificateFingerprint(certificatePem) }, 201);
});

/** Stores a key pair the owner made themselves (e.g. with `expo-updates codesigning:generate`). */
keys.post("/upload", requireHuman, requireSignedInOwner, async (c) => {
  const body = await parseBody(
    c,
    z.object({
      keyId: keyIdSchema.default(DEFAULT_KEY_ID),
      privateKeyPem: z.string().max(16_384),
      certificatePem: z.string().max(16_384),
    }),
  );
  const app = c.get("app");
  const kek = await requireKek(c.env);
  await assertUnusedKeyId(c, body.keyId);

  let pkcs8: Uint8Array;
  let privateKey: CryptoKey;
  try {
    pkcs8 = pemToPkcs8(body.privateKeyPem);
    privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITHM, false, ["sign"]);
  } catch {
    throw new HttpError(400, "The private key must be an RSA key in PEM format");
  }
  const matches = await keyMatchesCertificate(privateKey, body.certificatePem).catch(() => {
    throw new HttpError(400, "The certificate must be an X.509 certificate in PEM format");
  });
  if (!matches) throw new HttpError(400, "The certificate doesn't belong to this private key");

  await c.env.DB.batch([
    storeKeyStatement(c.env.DB, {
      appId: app.id,
      keyId: body.keyId,
      enc: await encryptPrivateKey(kek, pkcs8, app.id, body.keyId),
      certificatePem: body.certificatePem.trim() + "\n",
      source: "uploaded",
      actor: c.get("actor"),
    }),
    audit(c, { action: "key_create", target: body.keyId, details: { source: "uploaded" } }),
  ]);
  forgetSigner(app.id, body.keyId);
  return c.json({ keyId: body.keyId, fingerprint: await certificateFingerprint(body.certificatePem) }, 201);
});

/** Returns the private key. Owners only, signed in with a password they re-enter. */
keys.post("/:keyId/export", requireHuman, requireSignedInOwner, async (c) => {
  const { password } = await parseBody(c, z.object({ password: z.string().max(1024) }));
  if (c.get("via") !== "session") throw new HttpError(403, "Sign in to the dashboard to export a key");
  const row = await c.env.DB.prepare(`SELECT password_hash FROM admins WHERE id = ?`)
    .bind(c.get("admin")!.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(400, "Password is incorrect");

  const app = c.get("app");
  const keyId = c.req.param("keyId");
  const key = await c.env.DB.prepare(`SELECT private_key_enc FROM signing_keys WHERE app_id = ? AND key_id = ?`)
    .bind(app.id, keyId)
    .first<{ private_key_enc: string }>();
  if (!key) throw new HttpError(404, "Signing key not found");
  const pkcs8 = await decryptPrivateKey(await requireKek(c.env), key.private_key_enc, app.id, keyId);
  await audit(c, { action: "key_export", target: keyId }).run();
  return c.json({ keyId, privateKeyPem: pemEncode("PRIVATE KEY", pkcs8) });
});

/** Stops signing with a key. Builds that trust only this key stop receiving updates. */
keys.post("/:keyId/retire", requireHuman, requireSignedInOwner, async (c) => {
  const app = c.get("app");
  const keyId = c.req.param("keyId");
  const retired = await c.env.DB.prepare(
    `UPDATE signing_keys SET retired_at = ? WHERE app_id = ? AND key_id = ? AND retired_at IS NULL`,
  )
    .bind(new Date().toISOString(), app.id, keyId)
    .run();
  if (!retired.meta.changes) throw new HttpError(404, "No active signing key with that id");
  await audit(c, { action: "key_retire", target: keyId }).run();
  forgetSigner(app.id, keyId);
  return c.body(null, 204);
});

async function assertUnusedKeyId(c: Context<AppEnv>, keyId: string) {
  const app = c.get("app");
  const exists = await c.env.DB.prepare(`SELECT 1 FROM signing_keys WHERE app_id = ? AND key_id = ?`)
    .bind(app.id, keyId)
    .first();
  if (exists) throw new HttpError(409, `This app already has a key "${keyId}". Use a new key id to rotate.`);
}

export default keys;
