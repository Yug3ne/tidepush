import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decryptEnvValue, encryptEnvValue, envVarKey } from "../src/appenv";
import { hashToken } from "../src/auth/tokens";
import { keyEncryptionKey } from "../src/keys";
import { base64ToBytes } from "../src/lib/encoding";
import { ENV_TOKEN, call, personCall, signedIn } from "./helpers";

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** A fresh org with an app, its people, and an API token of that org. */
async function orgWithApp() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const orgId = `org_${suffix}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)`)
    .bind(orgId, `o-${suffix}`, "Org", now)
    .run();
  const owner = await signedIn("owner", orgId);
  const created = await personCall(`/admin/orgs/${orgId}/apps`, owner.id, { method: "POST", json: { name: "App" } });
  expect(created.status).toBe(201);
  const { id: appId } = await json<{ id: string }>(created);

  const token = `tp_${suffix}${"0".repeat(32)}`;
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, name, token_hash, prefix, org_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(`tok-${suffix}`, "ci", await hashToken(token), token.slice(3, 11), orgId, "test", now)
    .run();

  const path = (rest = "") => `/admin/apps/${appId}/env${rest}`;
  const withToken = (rest: string, init: RequestInit & { json?: unknown } = {}, bearer = token) =>
    call(path(rest), {
      ...init,
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: init.json === undefined ? init.body : JSON.stringify(init.json),
    });
  const set = (userId: string, vars: Record<string, string>, channel?: string) =>
    personCall(path(), userId, { method: "PUT", json: { vars, ...(channel ? { channel } : {}) } });
  const resolve = (channel: string) => withToken("/resolve", { method: "POST", json: { channel } });
  return { orgId, appId, owner, token, path, withToken, set, resolve };
}

describe("encryption at rest", () => {
  it("binds a value to its app, channel and name", async () => {
    const key = (await envVarKey(env))!;
    const slot = { appId: "app_a", channel: "production", name: "EXPO_PUBLIC_API_URL" };
    const enc = await encryptEnvValue(key, "https://api.acme.test", slot);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain("acme");
    expect(await decryptEnvValue(key, enc, slot)).toBe("https://api.acme.test");
    await expect(decryptEnvValue(key, enc, { ...slot, appId: "app_b" })).rejects.toThrow();
    await expect(decryptEnvValue(key, enc, { ...slot, channel: "staging" })).rejects.toThrow();
    await expect(decryptEnvValue(key, enc, { ...slot, name: "EXPO_PUBLIC_OTHER" })).rejects.toThrow();
  });

  it("uses a different key than the one that wraps signing keys", async () => {
    const key = (await envVarKey(env))!;
    const slot = { appId: "app_a", channel: "", name: "EXPO_PUBLIC_X" };
    const [, iv, ct] = (await encryptEnvValue(key, "value", slot)).split(".");
    const aad = new TextEncoder().encode(`${slot.appId}\n${slot.channel}\n${slot.name}`);
    await expect(
      crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(iv!), additionalData: aad },
        (await keyEncryptionKey(env))!,
        base64ToBytes(ct!),
      ),
    ).rejects.toThrow();
  });
});

describe("app environment variables", () => {
  it("are stored encrypted and returned only by resolve", async () => {
    const { appId, owner, path, set, resolve } = await orgWithApp();
    const res = await set(owner.id, { EXPO_PUBLIC_API_URL: "https://api.acme.test", EXPO_PUBLIC_KEY: "phc_secret" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const { results } = await env.DB.prepare(`SELECT * FROM app_env_vars WHERE app_id = ?`).bind(appId).all();
    expect(results).toHaveLength(2);
    expect(JSON.stringify(results)).not.toContain("acme.test");
    expect(JSON.stringify(results)).not.toContain("phc_secret");

    const listed = await personCall(path(), owner.id);
    const listBody = await listed.text();
    expect(listBody).not.toContain("acme.test");
    expect(listBody).not.toContain("phc_secret");
    expect((JSON.parse(listBody) as { vars: { name: string; channel: string | null }[] }).vars).toMatchObject([
      { name: "EXPO_PUBLIC_API_URL", channel: null, updatedBy: owner.email },
      { name: "EXPO_PUBLIC_KEY", channel: null },
    ]);

    const resolved = await resolve("production");
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get("cache-control")).toBe("no-store");
    expect(await resolved.json()).toEqual({
      channel: "production",
      vars: { EXPO_PUBLIC_API_URL: "https://api.acme.test", EXPO_PUBLIC_KEY: "phc_secret" },
    });
  });

  it("lets a channel's own value win over the shared one", async () => {
    const { owner, set, resolve } = await orgWithApp();
    await set(owner.id, { EXPO_PUBLIC_API_URL: "https://api.acme.test", EXPO_PUBLIC_SHARED: "1" });
    await set(owner.id, { EXPO_PUBLIC_API_URL: "https://staging.acme.test" }, "staging");
    expect((await json<{ vars: unknown }>(await resolve("staging"))).vars).toEqual({
      EXPO_PUBLIC_API_URL: "https://staging.acme.test",
      EXPO_PUBLIC_SHARED: "1",
    });
    expect((await json<{ vars: unknown }>(await resolve("production"))).vars).toEqual({
      EXPO_PUBLIC_API_URL: "https://api.acme.test",
      EXPO_PUBLIC_SHARED: "1",
    });
  });

  it("replaces a value and removes one", async () => {
    const { owner, path, set, resolve } = await orgWithApp();
    await set(owner.id, { EXPO_PUBLIC_A: "1", EXPO_PUBLIC_B: "2" });
    await set(owner.id, { EXPO_PUBLIC_A: "changed" });
    expect((await personCall(path("/EXPO_PUBLIC_B"), owner.id, { method: "DELETE" })).status).toBe(204);
    expect((await personCall(path("/EXPO_PUBLIC_B"), owner.id, { method: "DELETE" })).status).toBe(404);
    expect((await json<{ vars: unknown }>(await resolve("production"))).vars).toEqual({ EXPO_PUBLIC_A: "changed" });
  });

  it("returns nothing, and needs no key, for an app without variables", async () => {
    const { resolve } = await orgWithApp();
    expect(await (await resolve("production")).json()).toEqual({ channel: "production", vars: {} });
  });

  it("only accepts EXPO_PUBLIC_ names and sane values", async () => {
    const { owner, set } = await orgWithApp();
    for (const name of ["PATH", "NODE_OPTIONS", "LD_PRELOAD", "expo_public_x", "EXPO_PUBLIC_", "EXPO_PUBLIC_A B"]) {
      expect((await set(owner.id, { [name]: "x" })).status, name).toBe(400);
    }
    expect((await set(owner.id, { EXPO_PUBLIC_A: "" })).status).toBe(400);
    expect((await set(owner.id, { EXPO_PUBLIC_A: "line\nbreak" })).status).toBe(400);
    expect((await set(owner.id, { EXPO_PUBLIC_A: "x".repeat(4097) })).status).toBe(400);
    expect((await set(owner.id, {})).status).toBe(400);
    expect((await set(owner.id, { EXPO_PUBLIC_A: "x" }, "bad channel")).status).toBe(400);
  });

  it("limits how many variables a scope holds", async () => {
    const { owner, set } = await orgWithApp();
    const many = (from: number, n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`EXPO_PUBLIC_V${from + i}`, "x"]));
    expect((await set(owner.id, many(0, 100))).status).toBe(200);
    expect((await set(owner.id, many(0, 100))).status).toBe(200); // replacing is fine
    expect((await set(owner.id, many(100, 1))).status).toBe(400);
    expect((await set(owner.id, many(0, 101))).status).toBe(400);
  });
});

describe("access to environment variables", () => {
  it("lets admins write, and members only see names", async () => {
    const { orgId, owner, path, set } = await orgWithApp();
    const admin = await signedIn("admin", orgId);
    const member = await signedIn("member", orgId);
    expect((await set(admin.id, { EXPO_PUBLIC_A: "secret-value" })).status).toBe(200);
    expect((await set(owner.id, { EXPO_PUBLIC_B: "2" })).status).toBe(200);

    expect((await set(member.id, { EXPO_PUBLIC_A: "x" })).status).toBe(403);
    expect((await personCall(path("/EXPO_PUBLIC_A"), member.id, { method: "DELETE" })).status).toBe(403);
    const resolve = await personCall(path("/resolve"), member.id, { method: "POST", json: { channel: "production" } });
    expect(resolve.status).toBe(403);
    expect(await resolve.text()).not.toContain("secret-value");
    const list = await personCall(path(), member.id);
    expect(list.status).toBe(200);
    expect(await list.text()).not.toContain("secret-value");
  });

  it("lets API tokens read for a publish, but never write", async () => {
    const { owner, set, withToken, resolve } = await orgWithApp();
    await set(owner.id, { EXPO_PUBLIC_A: "1" });
    expect((await resolve("production")).status).toBe(200);
    const write = await withToken("", { method: "PUT", json: { vars: { EXPO_PUBLIC_A: "evil" } } });
    expect(write.status).toBe(403);
    expect((await withToken("/EXPO_PUBLIC_A", { method: "DELETE" })).status).toBe(403);
    expect((await json<{ vars: unknown }>(await resolve("production"))).vars).toEqual({ EXPO_PUBLIC_A: "1" });
  });

  it("refuses anyone without credentials", async () => {
    const { path } = await orgWithApp();
    expect((await call(path())).status).toBe(401);
    const res = await call(path("/resolve"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "production" }),
    });
    expect(res.status).toBe(401);
    // A header the web app uses internally means nothing from the internet.
    const spoofed = await call(path("/resolve"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-tidepush-user": "someone" },
      body: JSON.stringify({ channel: "production" }),
    });
    expect(spoofed.status).toBe(401);
  });

  it("hides one organization's variables from another", async () => {
    const mine = await orgWithApp();
    const theirs = await orgWithApp();
    await mine.set(mine.owner.id, { EXPO_PUBLIC_A: "mine-only" });

    // Their owner, their token and the default org's break-glass token all get 404, as if the app didn't exist.
    expect((await personCall(mine.path(), theirs.owner.id)).status).toBe(404);
    const stolen = await personCall(mine.path("/resolve"), theirs.owner.id, {
      method: "POST",
      json: { channel: "production" },
    });
    expect(stolen.status).toBe(404);
    expect(await stolen.text()).not.toContain("mine-only");
    expect((await theirs.set(theirs.owner.id, { EXPO_PUBLIC_A: "x" })).status).toBe(200);
    expect(
      (await personCall(mine.path(), theirs.owner.id, { method: "PUT", json: { vars: { EXPO_PUBLIC_A: "x" } } }))
        .status,
    ).toBe(404);
    for (const bearer of [ENV_TOKEN, theirs.token]) {
      const res = await mine.withToken("/resolve", { method: "POST", json: { channel: "production" } }, bearer);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("mine-only");
    }
  });

  it("keeps a token restricted to one app out of the others", async () => {
    const { orgId, owner, set, path } = await orgWithApp();
    await set(owner.id, { EXPO_PUBLIC_A: "1" });
    const other = await personCall(`/admin/orgs/${orgId}/apps`, owner.id, { method: "POST", json: { name: "Two" } });
    const { id: otherAppId } = await json<{ id: string }>(other);
    const token = `tp_restricted${crypto.randomUUID().replace(/-/g, "")}`;
    await env.DB.prepare(
      `INSERT INTO api_tokens (id, name, token_hash, prefix, org_id, app_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), "one-app", await hashToken(token), token.slice(3, 11), orgId, otherAppId, "t", "now")
      .run();
    const res = await call(path("/resolve"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "production" }),
    });
    expect(res.status).toBe(404);
  });

  it("records changes and reads in the audit log, without values", async () => {
    const { appId, owner, path, set, resolve } = await orgWithApp();
    await set(owner.id, { EXPO_PUBLIC_A: "audit-secret" }, "staging");
    await resolve("staging");
    await personCall(path("/EXPO_PUBLIC_A?channel=staging"), owner.id, { method: "DELETE" });
    const { results } = await env.DB.prepare(
      `SELECT actor, action, target, details_json FROM audit_log WHERE app_id = ? AND action LIKE 'env_%' ORDER BY id`,
    )
      .bind(appId)
      .all<{ actor: string; action: string; target: string; details_json: string }>();
    expect(results.map((r) => [r.action, r.actor, r.target])).toEqual([
      ["env_set", owner.email, "staging"],
      ["env_read", "token:ci", "staging"],
      ["env_delete", owner.email, "staging"],
    ]);
    expect(JSON.stringify(results)).not.toContain("audit-secret");
    expect(JSON.parse(results[0]!.details_json)).toEqual({ names: ["EXPO_PUBLIC_A"] });
  });

  it("fails closed when a stored value was tampered with", async () => {
    const mine = await orgWithApp();
    const theirs = await orgWithApp();
    await mine.set(mine.owner.id, { EXPO_PUBLIC_A: "mine" });
    await theirs.set(theirs.owner.id, { EXPO_PUBLIC_A: "theirs" });
    // Someone with database access copies another app's ciphertext into this app.
    await env.DB.prepare(
      `UPDATE app_env_vars SET value_enc = (SELECT value_enc FROM app_env_vars WHERE app_id = ?) WHERE app_id = ?`,
    )
      .bind(mine.appId, theirs.appId)
      .run();
    const res = await theirs.resolve("production");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("mine");
  });
});
