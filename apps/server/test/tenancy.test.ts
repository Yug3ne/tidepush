import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashToken } from "../src/auth/tokens";
import { encryptPrivateKey, keyEncryptionKey } from "../src/keys";
import { generateCodeSigningKey, publicKeyFromCertificate } from "../src/protocol/certificate";
import { base64ToBytes } from "../src/lib/encoding";
import { bytesToHex, sha256 } from "../src/lib/encoding";
import {
  ORIGIN,
  TOKEN,
  adminCall,
  personCall,
  call,
  createAdmin,
  parseMultipart,
  signedIn,
  uniqueChannel,
  parseSignatureHeader,
} from "./helpers";

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** A new org with one app and an org-wide API token. */
async function createOrg(opts: { apps?: number } = {}) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const orgId = `org_${suffix}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)`)
    .bind(orgId, `org-${suffix}`, `Org ${suffix}`, now)
    .run();
  const appIds: string[] = [];
  for (let i = 0; i < (opts.apps ?? 1); i++) appIds.push(await createApp(orgId));
  const token = await createToken(orgId);
  return { orgId, appId: appIds[0]!, appIds, token };
}

const certificates = new Map<string, string>();

/** An app with its own signing key "main", as the API creates them. */
async function createApp(orgId: string): Promise<string> {
  const appId = `app_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { pkcs8, certificatePem } = await generateCodeSigningKey(appId);
  const enc = await encryptPrivateKey((await keyEncryptionKey(env))!, pkcs8, appId, "main");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO apps (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`).bind(appId, orgId, `App ${appId}`, now),
    env.DB.prepare(
      `INSERT INTO signing_keys (app_id, key_id, private_key_enc, certificate_pem, source, created_by, created_at)
       VALUES (?, 'main', ?, ?, 'generated', 'test', ?)`,
    ).bind(appId, enc, certificatePem, now),
  ]);
  certificates.set(appId, certificatePem);
  return appId;
}

async function verifiedBy(certificatePem: string, body: string, signatureHeader: string) {
  const { sig } = parseSignatureHeader(signatureHeader);
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await publicKeyFromCertificate(certificatePem),
    base64ToBytes(sig!),
    new TextEncoder().encode(body),
  );
}

async function createToken(orgId: string, appId: string | null = null): Promise<string> {
  const token = `tp_${crypto.randomUUID().replace(/-/g, "")}`;
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, org_id, app_id, name, token_hash, prefix, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), orgId, appId, `t-${orgId}`, await hashToken(token), token.slice(3, 11), "test", new Date().toISOString())
    .run();
  return token;
}

function tokenCall(token: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  return call(`/admin${path}`, { ...init, headers, body });
}

/** Uploads a bundle to an app and publishes it there. */
async function publishTo(token: string, appId: string, opts: { channel?: string; bundle?: string } = {}) {
  const bytes = new TextEncoder().encode(opts.bundle ?? `bundle-${crypto.randomUUID()}`);
  const key = bytesToHex(await sha256(bytes));
  const up = await tokenCall(token, `/apps/${appId}/assets/${key}`, {
    method: "PUT",
    body: bytes,
    headers: { "content-type": "application/javascript", "x-file-extension": ".bundle" },
  });
  expect(up.status).toBe(201);
  const res = await tokenCall(token, `/apps/${appId}/updates`, {
    method: "POST",
    json: {
      channel: opts.channel ?? "production",
      updates: [{ platform: "android", runtimeVersion: "rt-1", launchAssetKey: key, assetKeys: [] }],
    },
  });
  expect(res.status).toBe(201);
  return { key, ...(await json<{ groupId: string; updates: { id: string }[] }>(res)) };
}

function manifestFor(path: string, channel = "production", clientId?: string) {
  return call(path, {
    headers: {
      accept: "multipart/mixed",
      "expo-protocol-version": "1",
      "expo-platform": "android",
      "expo-runtime-version": "rt-1",
      "expo-channel-name": channel,
      "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
      ...(clientId ? { "eas-client-id": clientId } : {}),
    },
  });
}

describe("migration", () => {
  it("moves existing data into the default org and app", async () => {
    expect(await env.DB.prepare(`SELECT id, slug FROM orgs WHERE id = 'org_default'`).first()).toEqual({
      id: "org_default",
      slug: "default",
    });
    expect(await env.DB.prepare(`SELECT org_id FROM apps WHERE id = 'app_default'`).first()).toEqual({
      org_id: "org_default",
    });
    const token = await env.DB.prepare(`SELECT org_id, app_id FROM api_tokens WHERE token_hash = ?`)
      .bind(await hashToken(TOKEN))
      .first();
    expect(token).toEqual({ org_id: "org_default", app_id: null });
  });
});

describe("protocol per app", () => {
  it("serves an app's updates at /<appId>/manifest with app-scoped, signed asset URLs", async () => {
    const org = await createOrg();
    const channel = uniqueChannel();
    const { key, updates } = await publishTo(org.token, org.appId, { channel });

    const res = await manifestFor(`/${org.appId}/manifest`, channel);
    expect(res.status).toBe(200);
    const [part] = await parseMultipart(res);
    const manifest = JSON.parse(part!.body);
    expect(manifest.id).toBe(updates[0]!.id);
    expect(manifest.launchAsset.url).toBe(`${ORIGIN}/${org.appId}/assets/${key}`);
    // Signed with this app's own key, not the deployment's.
    expect(await verifiedBy(certificates.get(org.appId)!, part!.body, part!.headers["expo-signature"]!)).toBe(true);
    expect(await verifiedBy(env.TEST_CERTIFICATE, part!.body, part!.headers["expo-signature"]!)).toBe(false);

    const asset = await call(`/${org.appId}/assets/${key}`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toMatch(/^bundle-/);
  });

  it("keeps apps apart: other apps, and the legacy paths, never see another app's updates or files", async () => {
    const a = await createOrg();
    const b = await createOrg();
    const channel = uniqueChannel();
    const { key } = await publishTo(a.token, a.appId, { channel });

    for (const path of [`/${b.appId}/manifest`, "/manifest"]) {
      const [part] = await parseMultipart(await manifestFor(path, channel));
      expect(part!.name).toBe("directive");
      expect(JSON.parse(part!.body)).toEqual({ type: "noUpdateAvailable" });
    }
    expect((await call(`/${b.appId}/assets/${key}`)).status).toBe(404);
    expect((await call(`/assets/${key}`)).status).toBe(404);
  });

  it("answers 404 for an unknown app", async () => {
    const res = await manifestFor("/app_doesnotexist/manifest");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "App not found" });
  });

  it("counts devices per app", async () => {
    const a = await createOrg();
    const b = await createOrg();
    const clientId = crypto.randomUUID();
    await manifestFor(`/${a.appId}/manifest`, "production", clientId);
    await manifestFor(`/${b.appId}/manifest`, "production", clientId);
    // Device writes happen in waitUntil; give them a moment.
    await new Promise((r) => setTimeout(r, 50));
    const rows = await env.DB.prepare(`SELECT app_id FROM devices WHERE client_id = ? ORDER BY app_id`)
      .bind(clientId)
      .all();
    expect(rows.results.map((r) => r.app_id).sort()).toEqual([a.appId, b.appId].sort());
    const stats = await json<{ totals: { devices: number }[] }>(await tokenCall(a.token, `/apps/${a.appId}/stats`));
    expect(stats.totals).toEqual([{ platform: "android", devices: 1 }]);
  });
});

describe("isolation between orgs", () => {
  it("answers 404 for another org's apps and orgs, for tokens and for people", async () => {
    const a = await createOrg();
    const b = await createOrg();
    const { groupId } = await publishTo(a.token, a.appId);

    expect((await tokenCall(b.token, `/apps/${a.appId}/updates`)).status).toBe(404);
    expect((await tokenCall(b.token, `/apps/${a.appId}/updates/${groupId}/rollback`, { method: "POST", json: {} })).status).toBe(404);
    expect((await tokenCall(b.token, `/orgs/${a.orgId}/apps`)).status).toBe(404);
    // The default org's token can't reach a new org either.
    expect((await adminCall(`/apps/${a.appId}/updates`)).status).toBe(404);

    const person = await signedIn("owner", b.orgId);
    expect((await personCall(`/admin/apps/${a.appId}`, person.id)).status).toBe(404);
    expect((await personCall(`/admin/orgs/${a.orgId}/members`, person.id)).status).toBe(404);
    expect((await personCall(`/admin/orgs/${a.orgId}/audit`, person.id)).status).toBe(404);
  });

  it("doesn't find another app's update by id, even within reach of the caller", async () => {
    const a = await createOrg();
    const b = await createOrg();
    const { groupId } = await publishTo(a.token, a.appId);
    expect((await tokenCall(b.token, `/apps/${b.appId}/updates/${groupId}`)).status).toBe(404);
    expect((await tokenCall(b.token, `/apps/${b.appId}/updates/${groupId}/rollout`, { method: "POST", json: { pct: 0 } })).status).toBe(404);
  });

  it("limits a token restricted to one app to that app", async () => {
    const org = await createOrg({ apps: 2 });
    const [first, second] = org.appIds as [string, string];
    const token = await createToken(org.orgId, first);
    expect((await tokenCall(token, `/apps/${first}/updates`)).status).toBe(200);
    expect((await tokenCall(token, `/apps/${second}/updates`)).status).toBe(404);
    // Unscoped paths use the token's app.
    expect((await tokenCall(token, "/updates")).status).toBe(200);
    const apps = await json<{ apps: { id: string }[] }>(await tokenCall(token, `/orgs/${org.orgId}/apps`));
    expect(apps.apps.map((a) => a.id)).toEqual([first]);
  });

  it("keeps each org's audit log separate", async () => {
    const a = await createOrg();
    const b = await createOrg();
    const { groupId } = await publishTo(a.token, a.appId);
    const owner = await signedIn("owner", b.orgId);
    const entries = await json<{ entries: { target: string }[] }>(
      await personCall(`/admin/orgs/${b.orgId}/audit`, owner.id),
    );
    expect(entries.entries.some((e) => e.target === groupId)).toBe(false);
    const appAudit = await json<{ entries: { action: string; target: string }[] }>(
      await tokenCall(a.token, `/apps/${a.appId}/audit`),
    );
    expect(appAudit.entries).toEqual(expect.arrayContaining([expect.objectContaining({ action: "publish", target: groupId })]));
  });
});

describe("unscoped (legacy) paths", () => {
  it("need a choice once an org has several apps", async () => {
    const org = await createOrg({ apps: 2 });
    const res = await tokenCall(org.token, "/updates");
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/2 apps/);
    expect((await tokenCall(org.token, `/apps/${org.appIds[1]}/updates`)).status).toBe(200);
  });

  it("need a choice for people in several orgs", async () => {
    const b = await createOrg();
    const person = await signedIn("owner");
    await env.DB.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)`)
      .bind(b.orgId, person.id, new Date().toISOString())
      .run();
    expect((await personCall("/admin/tokens", person.id)).status).toBe(400);
    expect((await personCall(`/admin/orgs/${b.orgId}/tokens`, person.id)).status).toBe(200);
    const me = await json<{ orgs: { id: string; role: string }[] }>(await personCall("/admin/me", person.id));
    expect(me.orgs.map((o) => o.id)).toEqual(["org_default", b.orgId]);
  });
});

describe("roles", () => {
  it("makes members read-only", async () => {
    const org = await createOrg();
    const { groupId } = await publishTo(org.token, org.appId);
    const member = await signedIn("member", org.orgId);
    expect((await personCall(`/admin/apps/${org.appId}/updates`, member.id)).status).toBe(200);
    expect((await personCall(`/admin/orgs/${org.orgId}/audit`, member.id)).status).toBe(200);
    const write = await personCall(`/admin/apps/${org.appId}/updates/${groupId}/rollout`, member.id, {
      method: "POST",
      json: { pct: 10 },
    });
    expect(write.status).toBe(403);
    expect((await personCall(`/admin/orgs/${org.orgId}/tokens`, member.id, { method: "POST", json: { name: "x" } })).status).toBe(403);
    expect((await personCall(`/admin/orgs/${org.orgId}/apps`, member.id, { method: "POST", json: { name: "x" } })).status).toBe(403);
    expect((await personCall(`/admin/orgs/${org.orgId}/members`, member.id)).status).toBe(403);
  });

  it("lets owners change roles, but never demote the last owner", async () => {
    const org = await createOrg();
    const owner = await signedIn("owner", org.orgId);
    const other = await createAdmin({ role: "member", orgId: org.orgId });
    const path = (id: string) => `/admin/orgs/${org.orgId}/members/${id}`;

    const promoted = await personCall(path(other.id), owner.id, { method: "PATCH", json: { role: "admin" } });
    expect(await json(promoted)).toEqual({ id: other.id, role: "admin" });
    expect((await personCall(path(owner.id), owner.id, { method: "PATCH", json: { role: "admin" } })).status).toBe(409);

    await personCall(path(other.id), owner.id, { method: "PATCH", json: { role: "owner" } });
    expect((await personCall(path(owner.id), owner.id, { method: "PATCH", json: { role: "member" } })).status).toBe(200);
  });
});

describe("apps", () => {
  it("are created by people (not tokens) and get a URL-safe id", async () => {
    const org = await createOrg();
    const owner = await signedIn("owner", org.orgId);
    const res = await personCall(`/admin/orgs/${org.orgId}/apps`, owner.id, { method: "POST", json: { name: "Second" } });
    expect(res.status).toBe(201);
    const app = await json<{ id: string; name: string }>(res);
    expect(app.id).toMatch(/^app_[a-z0-9]{12}$/);
    expect((await tokenCall(org.token, `/orgs/${org.orgId}/apps`, { method: "POST", json: { name: "x" } })).status).toBe(403);

    const list = await json<{ apps: { id: string }[] }>(await personCall(`/admin/orgs/${org.orgId}/apps`, owner.id));
    expect(list.apps.map((a) => a.id)).toContain(app.id);
    const [part] = await parseMultipart(await manifestFor(`/${app.id}/manifest`));
    expect(JSON.parse(part!.body)).toEqual({ type: "noUpdateAvailable" });
  });

  it("issue tokens restricted to one of the org's apps only", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const owner = await signedIn("owner", org.orgId);
    const path = `/admin/orgs/${org.orgId}/tokens`;
    const ok = await personCall(path, owner.id, { method: "POST", json: { name: "ci", appId: org.appId } });
    expect(ok.status).toBe(201);
    const { token } = await json<{ token: string }>(ok);
    expect((await tokenCall(token, `/apps/${org.appId}/updates`)).status).toBe(200);
    expect((await personCall(path, owner.id, { method: "POST", json: { name: "x", appId: other.appId } })).status).toBe(404);
  });
});

describe("invites across orgs", () => {
  it("lets an existing person join a second org, once signed in", async () => {
    const org = await createOrg();
    const owner = await signedIn("owner", org.orgId);
    const person = await createAdmin({ role: "admin" });

    const invite = await json<{ inviteUrl: string }>(
      await personCall(`/admin/orgs/${org.orgId}/members/invites`, owner.id, {
        method: "POST",
        json: { email: person.email, role: "member" },
      }),
    );
    const token = invite.inviteUrl.split("/invite/")[1]!;

    // They have an account, so the invite page sends them to sign in rather than make a new one.
    const info = await json<{ hasAccount: boolean }>(await personCall(`/auth/invites/${token}`, null));
    expect(info.hasAccount).toBe(true);
    const asNew = await personCall(`/auth/invites/${token}/accept`, null, {
      method: "POST",
      json: { name: "Imposter", password: "a password nobody knows" },
    });
    expect(asNew.status).toBe(409);

    const accepted = await personCall(`/admin/invites/${token}/accept`, person.id, { method: "POST" });
    expect(accepted.status).toBe(201);
    expect((await personCall(`/admin/orgs/${org.orgId}/apps`, person.id)).status).toBe(200);
    expect((await personCall(`/admin/apps/app_default/updates`, person.id)).status).toBe(200);
  });
});
