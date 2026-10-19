import { env } from "cloudflare:workers";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { decryptPrivateKey, encryptPrivateKey, keyEncryptionKey } from "../src/keys";
import { base64ToBytes } from "../src/lib/encoding";
import { generateCodeSigningKey, pemEncode, publicKeyFromCertificate } from "../src/protocol/certificate";
import { PASSWORD, TOKEN, personCall, call, parseMultipart, parseSignatureHeader, signedIn } from "./helpers";

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

async function verifiedBy(certificatePem: string, body: string, signatureHeader: string) {
  const { sig } = parseSignatureHeader(signatureHeader);
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await publicKeyFromCertificate(certificatePem),
    base64ToBytes(sig!),
    new TextEncoder().encode(body),
  );
}

function manifest(appId: string, keyId = "main") {
  return call(`/${appId}/manifest`, {
    headers: {
      accept: "multipart/mixed",
      "expo-protocol-version": "1",
      "expo-platform": "android",
      "expo-runtime-version": "rt-1",
      "expo-channel-name": "production",
      "expo-expect-signature": `sig, keyid="${keyId}", alg="rsa-v1_5-sha256"`,
    },
  });
}

async function signedDirective(appId: string, keyId = "main") {
  const res = await manifest(appId, keyId);
  if (res.status !== 200) return { status: res.status, body: "", signature: "" };
  const [part] = await parseMultipart(res);
  return { status: 200, body: part!.body, signature: part!.headers["expo-signature"]! };
}

/** A fresh org whose signed-in owner creates an app through the API. */
async function ownerWithApp() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const orgId = `org_${suffix}`;
  await env.DB.prepare(`INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)`)
    .bind(orgId, `o-${suffix}`, "Org", new Date().toISOString())
    .run();
  const owner = await signedIn("owner", orgId);
  const res = await personCall(`/admin/orgs/${orgId}/apps`, owner.id, { method: "POST", json: { name: "My App" } });
  expect(res.status).toBe(201);
  const app = await json<{ id: string; signingKey: { keyId: string; certificatePem: string } }>(res);
  return { orgId, owner, app, keys: (path = "") => `/admin/apps/${app.id}/keys${path}` };
}

describe("generated certificates", () => {
  it("are self-signed code-signing certificates, valid for 10 years", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const { certificatePem } = await generateCodeSigningKey("Payd Money", now);
    const cert = forge.pki.certificateFromPem(certificatePem);
    expect(cert.verify(cert)).toBe(true);
    expect(cert.subject.getField("CN").value).toBe("Payd Money");
    expect(cert.validity.notBefore.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(cert.validity.notAfter.toISOString()).toBe("2036-10-15T12:00:00.000Z");
    const keyUsage = cert.getExtension("keyUsage") as { critical: boolean; digitalSignature: boolean };
    expect(keyUsage).toMatchObject({ critical: true, digitalSignature: true });
    const extKeyUsage = cert.getExtension("extKeyUsage") as { critical: boolean; codeSigning: boolean };
    expect(extKeyUsage).toMatchObject({ critical: true, codeSigning: true });
    expect((cert.publicKey as forge.pki.rsa.PublicKey).n.bitLength()).toBe(2048);
  });
});

describe("encryption at rest", () => {
  it("binds a ciphertext to its app and key id", async () => {
    const kek = (await keyEncryptionKey(env))!;
    const secret = crypto.getRandomValues(new Uint8Array(64));
    const enc = await encryptPrivateKey(kek, secret, "app_a", "main");
    expect(enc).toMatch(/^v1\./);
    expect(await decryptPrivateKey(kek, enc, "app_a", "main")).toEqual(secret);
    await expect(decryptPrivateKey(kek, enc, "app_b", "main")).rejects.toThrow();
    await expect(decryptPrivateKey(kek, enc, "app_a", "next")).rejects.toThrow();
  });
});

describe("app signing keys", () => {
  it("are created with the app, and sign that app's responses", async () => {
    const { owner, app, keys } = await ownerWithApp();
    expect(app.signingKey.keyId).toBe("main");
    const signed = await signedDirective(app.id);
    expect(await verifiedBy(app.signingKey.certificatePem, signed.body, signed.signature)).toBe(true);
    expect(parseSignatureHeader(signed.signature).keyid).toBe("main");

    const list = await json<{ keys: { keyId: string; source: string; fingerprint: string }[] }>(
      await personCall(keys(), owner.id),
    );
    expect(list.keys).toEqual([expect.objectContaining({ keyId: "main", source: "generated" })]);
    expect(list.keys[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const download = await personCall(keys("/main/certificate"), owner.id);
    expect(download.headers.get("content-type")).toBe("application/x-pem-file");
    expect(await download.text()).toBe(app.signingKey.certificatePem);
  });

  it("rotate: a new key id signs for new builds while the old one keeps working, until retired", async () => {
    const { owner, app, keys } = await ownerWithApp();
    const created = await personCall(keys(), owner.id, { method: "POST", json: { keyId: "2027" } });
    expect(created.status).toBe(201);
    const next = await json<{ certificatePem: string }>(created);

    const fromNew = await signedDirective(app.id, "2027");
    expect(await verifiedBy(next.certificatePem, fromNew.body, fromNew.signature)).toBe(true);
    const fromOld = await signedDirective(app.id, "main");
    expect(await verifiedBy(app.signingKey.certificatePem, fromOld.body, fromOld.signature)).toBe(true);

    expect((await personCall(keys(), owner.id, { method: "POST", json: { keyId: "2027" } })).status).toBe(409);
    expect((await personCall(keys("/main/retire"), owner.id, { method: "POST" })).status).toBe(204);
    expect((await signedDirective(app.id, "main")).status).toBe(500);
    expect((await signedDirective(app.id, "2027")).status).toBe(200);
  });

  it("accept an uploaded key pair, but only a matching one", async () => {
    const { owner, app, keys } = await ownerWithApp();
    const mine = await generateCodeSigningKey("Mine");
    const other = await generateCodeSigningKey("Other");
    const privateKeyPem = pemEncode("PRIVATE KEY", mine.pkcs8);

    const mismatch = await personCall(keys("/upload"), owner.id, {
      method: "POST",
      json: { keyId: "own", privateKeyPem, certificatePem: other.certificatePem },
    });
    expect(mismatch.status).toBe(400);
    const garbage = await personCall(keys("/upload"), owner.id, {
      method: "POST",
      json: { keyId: "own", privateKeyPem: "nope", certificatePem: mine.certificatePem },
    });
    expect(garbage.status).toBe(400);

    const ok = await personCall(keys("/upload"), owner.id, {
      method: "POST",
      json: { keyId: "own", privateKeyPem, certificatePem: mine.certificatePem },
    });
    expect(ok.status).toBe(201);
    const signed = await signedDirective(app.id, "own");
    expect(await verifiedBy(mine.certificatePem, signed.body, signed.signature)).toBe(true);
  });

  it("export only to a signed-in owner who re-enters their password, and are audited", async () => {
    const { orgId, owner, app, keys } = await ownerWithApp();
    expect((await personCall(keys("/main/export"), owner.id, { method: "POST", json: { password: "wrong-password-123" } })).status).toBe(400);

    const res = await personCall(keys("/main/export"), owner.id, { method: "POST", json: { password: PASSWORD } });
    expect(res.status).toBe(200);
    const { privateKeyPem } = await json<{ privateKeyPem: string }>(res);
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    // The exported key is the one the certificate belongs to.
    const exported = forge.pki.privateKeyFromPem(privateKeyPem);
    const cert = forge.pki.certificateFromPem(app.signingKey.certificatePem);
    expect(exported.n.toString(16)).toBe((cert.publicKey as forge.pki.rsa.PublicKey).n.toString(16));

    const audit = await json<{ entries: { action: string; actor: string; target: string }[] }>(
      await personCall(`/admin/orgs/${orgId}/audit`, owner.id),
    );
    expect(audit.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "key_export", actor: owner.email, target: "main" })]),
    );
  });

  it("are managed by owners only; others can still read the certificates", async () => {
    const { orgId, app, keys } = await ownerWithApp();
    const admin = await signedIn("admin", orgId);
    expect((await personCall(keys(), admin.id)).status).toBe(200);
    expect((await personCall(keys("/main/certificate"), admin.id)).status).toBe(200);
    for (const [path, body] of [
      [keys(), { keyId: "x" }],
      [keys("/main/export"), { password: PASSWORD }],
      [keys("/main/retire"), {}],
    ] as const) {
      expect((await personCall(path, admin.id, { method: "POST", json: body })).status).toBe(403);
    }
    // And never with an API token, even an org-wide one from the same org.
    expect((await personCall(`/admin/apps/${app.id}/keys`, null)).status).toBe(401);
  });
});

describe("the default app", () => {
  it("keeps signing with the deployment's key and reports it", async () => {
    const res = await call("/admin/apps/app_default/keys", { headers: { authorization: `Bearer ${TOKEN}` } });
    const body = await json<{ keys: unknown[]; environmentKey: { keyId: string; source: string } | null }>(res);
    expect(body.environmentKey).toEqual({ keyId: "main", source: "environment" });
    const exportByToken = await call("/admin/apps/app_default/keys/main/export", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(exportByToken.status).toBe(403);
  });

  it("won't let a new key take over the server key's id, which builds in use trust", async () => {
    const owner = await signedIn("owner");
    const path = "/admin/apps/app_default/keys";
    expect((await personCall(path, owner.id, { method: "POST", json: { keyId: "main" } })).status).toBe(409);

    const other = await generateCodeSigningKey("Other");
    const upload = await personCall(`${path}/upload`, owner.id, {
      method: "POST",
      json: { keyId: "main", privateKeyPem: pemEncode("PRIVATE KEY", other.pkcs8), certificatePem: other.certificatePem },
    });
    expect(upload.status).toBe(409);

    // The same key pair can be moved into the database, and keeps signing for existing builds.
    const same = await personCall(`${path}/upload`, owner.id, {
      method: "POST",
      json: { keyId: "main", privateKeyPem: env.CODE_SIGNING_PRIVATE_KEY, certificatePem: env.TEST_CERTIFICATE },
    });
    expect(same.status).toBe(201);
    const signed = await signedDirective("app_default", "main");
    expect(await verifiedBy(env.TEST_CERTIFICATE, signed.body, signed.signature)).toBe(true);
  });
});
