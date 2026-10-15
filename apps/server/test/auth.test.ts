import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/auth/tokens";
import { bytesToBase64Url } from "../src/lib/encoding";
import {
  ENV_TOKEN,
  ORIGIN,
  PASSWORD,
  adminCall,
  browserCall,
  call,
  cookieFrom,
  createAdmin,
  login,
  signedIn,
} from "./helpers";

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const sessionHash = async (cookie: string) => hashToken(cookie.split("=")[1]!);
const auditActions = async (action: string) =>
  (await env.DB.prepare(`SELECT * FROM audit_log WHERE action = ?`).bind(action).all()).results;

describe("login", () => {
  it("signs in with a session cookie that has the right attributes", async () => {
    const { email } = await createAdmin({ email: "login@example.com", role: "admin" });
    const res = await browserCall("/auth/login", null, {
      method: "POST",
      json: { email: " LOGIN@example.com ", password: PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ admin: { email, role: "admin", name: "Test Admin" } });

    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^__Host-tidepush_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=604800");
    expect(setCookie).not.toMatch(/Domain=/i);

    // Only the hash is stored.
    const cookie = cookieFrom(res);
    const row = await env.DB.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).bind(await sessionHash(cookie)).first();
    expect(row).not.toBeNull();
    expect(await auditActions("login")).toEqual(expect.arrayContaining([expect.objectContaining({ actor: email })]));
  });

  it("returns the same generic error for a wrong password and an unknown email", async () => {
    await createAdmin({ email: "generic@example.com" });
    const wrong = await browserCall("/auth/login", null, {
      method: "POST",
      json: { email: "generic@example.com", password: "wrong password!!" },
    });
    const unknown = await browserCall("/auth/login", null, {
      method: "POST",
      json: { email: "nobody@example.com", password: "wrong password!!" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await json(wrong)).toEqual({ error: "Invalid email or password" });
    expect(await json(unknown)).toEqual({ error: "Invalid email or password" });
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("refuses disabled admins with the generic error", async () => {
    const { email, id } = await createAdmin();
    await env.DB.prepare(`UPDATE admins SET disabled_at = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
    const res = await browserCall("/auth/login", null, { method: "POST", json: { email, password: PASSWORD } });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "Invalid email or password" });
  });

  it("rate limits an email after 5 failures, even with the right password", async () => {
    const { email } = await createAdmin({ email: "limited@example.com" });
    for (let i = 0; i < 5; i++) {
      const res = await browserCall("/auth/login", null, { method: "POST", json: { email, password: "nope nope nope" } });
      expect(res.status).toBe(401);
    }
    const res = await browserCall("/auth/login", null, { method: "POST", json: { email, password: PASSWORD } });
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);

    // Once the failures are older than 15 minutes, login works and clears them.
    await env.DB.prepare(`UPDATE login_failures SET at = ? WHERE email = ?`)
      .bind(new Date(Date.now() - 16 * 60 * 1000).toISOString(), email)
      .run();
    expect((await browserCall("/auth/login", null, { method: "POST", json: { email, password: PASSWORD } })).status).toBe(200);
    const { n } = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_failures WHERE email = ?`).bind(email).first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it("rate limits an IP after 20 failures across emails", async () => {
    const headers = { "cf-connecting-ip": "203.0.113.7" };
    for (let i = 0; i < 20; i++) {
      await browserCall("/auth/login", null, {
        method: "POST",
        headers,
        json: { email: `spray-${i}@example.com`, password: "nope nope nope" },
      });
    }
    const { email } = await createAdmin();
    const blocked = await browserCall("/auth/login", null, { method: "POST", headers, json: { email, password: PASSWORD } });
    expect(blocked.status).toBe(429);
    // Another IP is unaffected.
    const other = await browserCall("/auth/login", null, {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.8" },
      json: { email, password: PASSWORD },
    });
    expect(other.status).toBe(200);
  });

  it("refuses a cross-origin login", async () => {
    const { email } = await createAdmin();
    const res = await browserCall("/auth/login", null, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      json: { email, password: PASSWORD },
    });
    expect(res.status).toBe(403);
  });
});

describe("sessions", () => {
  it("logout deletes the session and clears the cookie", async () => {
    const { cookie, email } = await signedIn();
    const res = await browserCall("/auth/logout", cookie, { method: "POST" });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-tidepush_session=;.*Max-Age=0/);
    expect((await browserCall("/admin/me", cookie)).status).toBe(401);
    expect(await json(await browserCall("/auth/status", cookie))).toEqual({ needsSetup: false, admin: null });
    expect(await auditActions("logout")).toEqual(expect.arrayContaining([expect.objectContaining({ actor: email })]));
  });

  it("expires after 24h idle", async () => {
    const { cookie } = await signedIn();
    const hash = await sessionHash(cookie);
    await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`)
      .bind(new Date(Date.now() - 25 * 3600_000).toISOString(), hash)
      .run();
    expect((await browserCall("/admin/me", cookie)).status).toBe(401);
    expect(await env.DB.prepare(`SELECT 1 FROM sessions WHERE token_hash = ?`).bind(hash).first()).toBeNull();
  });

  it("expires after 7 days even when active", async () => {
    const { cookie } = await signedIn();
    await env.DB.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), await sessionHash(cookie))
      .run();
    expect((await browserCall("/admin/me", cookie)).status).toBe(401);
  });

  it("slides last_seen_at, at most every 5 minutes", async () => {
    const { cookie } = await signedIn();
    const hash = await sessionHash(cookie);
    const lastSeen = async () =>
      (await env.DB.prepare(`SELECT last_seen_at FROM sessions WHERE token_hash = ?`).bind(hash).first<{ last_seen_at: string }>())!
        .last_seen_at;
    const recent = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(recent, hash).run();
    await browserCall("/admin/me", cookie);
    expect(await lastSeen()).toBe(recent);

    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(old, hash).run();
    expect((await browserCall("/admin/me", cookie)).status).toBe(200);
    expect(Date.parse(await lastSeen())).toBeGreaterThan(Date.now() - 60_000);
  });

  it("ignores a forged cookie", async () => {
    expect((await browserCall("/admin/me", "__Host-tidepush_session=forged")).status).toBe(401);
  });
});

describe("CSRF", () => {
  const assetsMissing = { method: "POST", json: { keys: [] } };

  it("refuses cookie-authenticated mutations without a same-origin Origin", async () => {
    const { cookie } = await signedIn();
    const noOrigin = await call("/admin/assets/missing", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ keys: [] }),
    });
    expect(noOrigin.status).toBe(403);
    const evil = await browserCall("/admin/assets/missing", cookie, { ...assetsMissing, headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    const ok = await browserCall("/admin/assets/missing", cookie, assetsMissing);
    expect(ok.status).toBe(200);
  });

  it("lets cookie-authenticated GETs through without Origin", async () => {
    const { cookie } = await signedIn();
    expect((await call("/admin/me", { headers: { cookie } })).status).toBe(200);
  });

  it("does not apply to bearer tokens", async () => {
    const res = await adminCall("/assets/missing", { ...assetsMissing, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});

describe("password change", () => {
  it("changes the password and signs out other sessions", async () => {
    const { email, cookie } = await signedIn("admin");
    const other = await login(email);
    const res = await browserCall("/admin/me/password", cookie, {
      method: "POST",
      json: { currentPassword: PASSWORD, newPassword: "a brand new password" },
    });
    expect(res.status).toBe(204);
    expect((await browserCall("/admin/me", cookie)).status).toBe(200);
    expect((await browserCall("/admin/me", other)).status).toBe(401);
    await login(email, "a brand new password");
    expect(await auditActions("password_change")).toEqual(expect.arrayContaining([expect.objectContaining({ actor: email })]));
  });

  it("requires the current password and a session", async () => {
    const { cookie } = await signedIn();
    const wrong = await browserCall("/admin/me/password", cookie, {
      method: "POST",
      json: { currentPassword: "not my password", newPassword: "a brand new password" },
    });
    expect(wrong.status).toBe(400);
    const viaToken = await adminCall("/me/password", {
      method: "POST",
      json: { currentPassword: PASSWORD, newPassword: "a brand new password" },
    });
    expect(viaToken.status).toBe(403);
  });
});

describe("team", () => {
  it("is owner-only", async () => {
    const { cookie } = await signedIn("admin");
    expect((await browserCall("/admin/admins", cookie)).status).toBe(403);
    expect(
      (await browserCall("/admin/admins/invites", cookie, { method: "POST", json: { email: "x@example.com", role: "admin" } })).status,
    ).toBe(403);
    const victim = await createAdmin();
    expect((await browserCall(`/admin/admins/${victim.id}`, cookie, { method: "DELETE" })).status).toBe(403);
    // API tokens are not people, so they can't manage the team either.
    expect((await adminCall("/admins")).status).toBe(403);
    // But admins can still do everything else.
    expect((await browserCall("/admin/updates", cookie)).status).toBe(200);
  });

  it("invites an admin: view, accept (signed in), single use", async () => {
    const owner = await signedIn();
    const res = await browserCall("/admin/admins/invites", owner.cookie, {
      method: "POST",
      json: { email: "New.Person@Example.com", role: "admin" },
    });
    expect(res.status).toBe(201);
    const { inviteUrl, expiresAt } = await json<{ inviteUrl: string; expiresAt: string }>(res);
    expect(inviteUrl).toMatch(new RegExp(`^${ORIGIN}/invite/[A-Za-z0-9_-]{43}$`));
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(71 * 3600_000);
    const token = inviteUrl.split("/").pop()!;

    const team = await json<{ invites: { email: string }[] }>(await browserCall("/admin/admins", owner.cookie));
    expect(team.invites.map((i) => i.email)).toContain("new.person@example.com");

    const view = await call(`/auth/invites/${token}`);
    expect(view.status).toBe(200);
    expect(await json(view)).toEqual({ email: "new.person@example.com", role: "admin", expiresAt });

    const accept = await browserCall(`/auth/invites/${token}/accept`, null, {
      method: "POST",
      json: { name: "New Person", password: PASSWORD },
    });
    expect(accept.status).toBe(201);
    expect(await json(accept)).toMatchObject({ admin: { email: "new.person@example.com", role: "admin", name: "New Person" } });
    const me = await browserCall("/admin/me", cookieFrom(accept));
    expect(await json(me)).toMatchObject({ actor: "new.person@example.com", via: "session" });

    expect((await call(`/auth/invites/${token}`)).status).toBe(410);
    const again = await browserCall(`/auth/invites/${token}/accept`, null, {
      method: "POST",
      json: { name: "Someone Else", password: PASSWORD },
    });
    expect(again.status).toBe(410);
    expect(await auditActions("invite_accept")).toHaveLength(1);
    expect(await auditActions("invite")).toHaveLength(1);
  });

  it("rejects expired and unknown invites", async () => {
    const owner = await signedIn();
    const res = await browserCall("/admin/admins/invites", owner.cookie, {
      method: "POST",
      json: { email: "late@example.com", role: "admin" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    await env.DB.prepare(`UPDATE invites SET expires_at = ? WHERE token_hash = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), await hashToken(token))
      .run();
    expect((await call(`/auth/invites/${token}`)).status).toBe(410);
    const accept = await browserCall(`/auth/invites/${token}/accept`, null, {
      method: "POST",
      json: { name: "Late", password: PASSWORD },
    });
    expect(accept.status).toBe(410);
    expect((await call(`/auth/invites/not-a-real-token`)).status).toBe(404);
  });

  it("refuses to invite an existing admin, and revokes pending invites", async () => {
    const owner = await signedIn();
    const existing = await createAdmin();
    const dup = await browserCall("/admin/admins/invites", owner.cookie, {
      method: "POST",
      json: { email: existing.email, role: "admin" },
    });
    expect(dup.status).toBe(409);

    const res = await browserCall("/admin/admins/invites", owner.cookie, {
      method: "POST",
      json: { email: "revoke-me@example.com", role: "owner" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    const del = await browserCall("/admin/admins/invites/revoke-me@example.com", owner.cookie, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await call(`/auth/invites/${token}`)).status).toBe(404);
    expect((await browserCall("/admin/admins/invites/revoke-me@example.com", owner.cookie, { method: "DELETE" })).status).toBe(404);
  });

  it("removes an admin: disables them and ends their sessions", async () => {
    const owner = await signedIn();
    const victim = await signedIn("admin");
    const res = await browserCall(`/admin/admins/${victim.id}`, owner.cookie, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await browserCall("/admin/me", victim.cookie)).status).toBe(401);
    const team = await json<{ admins: { id: string; disabled: boolean }[] }>(await browserCall("/admin/admins", owner.cookie));
    expect(team.admins.find((a) => a.id === victim.id)?.disabled).toBe(true);
    expect((await browserCall(`/admin/admins/${victim.id}`, owner.cookie, { method: "DELETE" })).status).toBe(404);
    expect(await auditActions("admin_remove")).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor: owner.email, target: victim.email })]),
    );
  });

  it("refuses to remove yourself, so the last owner always stays", async () => {
    const owner = await signedIn();
    expect((await browserCall(`/admin/admins/${owner.id}`, owner.cookie, { method: "DELETE" })).status).toBe(400);

    // Owners can remove other owners; the caller (an owner) always remains.
    const other = await createAdmin({ role: "owner" });
    expect((await browserCall(`/admin/admins/${other.id}`, owner.cookie, { method: "DELETE" })).status).toBe(204);
    const self = await env.DB.prepare(`SELECT disabled_at FROM admins WHERE id = ?`).bind(owner.id).first();
    expect(self).toEqual({ disabled_at: null });
  });

  it("lets a removed admin be invited back", async () => {
    const owner = await signedIn();
    const victim = await createAdmin({ email: "comeback@example.com", role: "admin" });
    await browserCall(`/admin/admins/${victim.id}`, owner.cookie, { method: "DELETE" });
    const res = await browserCall("/admin/admins/invites", owner.cookie, {
      method: "POST",
      json: { email: "comeback@example.com", role: "admin" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    const accept = await browserCall(`/auth/invites/${token}/accept`, null, {
      method: "POST",
      json: { name: "Back Again", password: "a completely new password" },
    });
    expect(accept.status).toBe(201);
    expect(await json(accept)).toMatchObject({ admin: { id: victim.id, email: "comeback@example.com" } });
  });
});

describe("API tokens", () => {
  it("creates (plaintext once), uses, lists and revokes a token", async () => {
    const { cookie, email } = await signedIn("admin");
    const res = await browserCall("/admin/tokens", cookie, { method: "POST", json: { name: "ci" } });
    expect(res.status).toBe(201);
    const created = await json<{ token: string; id: string; name: string; prefix: string }>(res);
    expect(created.token).toMatch(/^tp_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(3, 11));

    // Stored hashed only.
    const row = await env.DB.prepare(`SELECT * FROM api_tokens WHERE id = ?`).bind(created.id).first<Record<string, string>>();
    expect(row!.token_hash).toBe(await hashToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const bearer = { authorization: `Bearer ${created.token}` };
    const me = await call("/admin/me", { headers: bearer });
    expect(await json(me)).toEqual({ actor: "token:ci", admin: null, via: "token" });

    const list = await json<{ tokens: Record<string, unknown>[] }>(await browserCall("/admin/tokens", cookie));
    const listed = list.tokens.find((t) => t.id === created.id)!;
    expect(listed).toMatchObject({ name: "ci", prefix: created.prefix, createdBy: email });
    expect(listed.lastUsedAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain(created.token);

    expect((await browserCall(`/admin/tokens/${created.id}`, cookie, { method: "DELETE" })).status).toBe(204);
    expect((await call("/admin/me", { headers: bearer })).status).toBe(401);
    const after = await json<{ tokens: { id: string }[] }>(await browserCall("/admin/tokens", cookie));
    expect(after.tokens.some((t) => t.id === created.id)).toBe(false);
    expect((await browserCall(`/admin/tokens/${created.id}`, cookie, { method: "DELETE" })).status).toBe(404);

    expect(await auditActions("token_create")).toEqual(expect.arrayContaining([expect.objectContaining({ actor: email, target: created.id })]));
    expect(await auditActions("token_revoke")).toEqual(expect.arrayContaining([expect.objectContaining({ target: created.id })]));
  });

  it("can't be managed with an API token", async () => {
    expect((await adminCall("/tokens")).status).toBe(403);
    expect((await adminCall("/tokens", { method: "POST", json: { name: "x" } })).status).toBe(403);
    expect((await call("/admin/tokens", { headers: { authorization: `Bearer ${ENV_TOKEN}` } })).status).toBe(403);
  });
});

describe("Cloudflare Access", () => {
  afterEach(() => vi.restoreAllMocks());

  async function accessJwt(claims: Record<string, unknown>) {
    const teamDomain = env.ACCESS_TEAM_DOMAIN;
    const kid = crypto.randomUUID();
    const keys = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = { ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey), kid };
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `https://${teamDomain}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
      return realFetch(input, init);
    });
    const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
    const input = `${enc({ alg: "RS256", kid })}.${enc({
      aud: [env.ACCESS_AUD],
      iss: `https://${teamDomain}`,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input));
    return `${input}.${bytesToBase64Url(new Uint8Array(sig))}`;
  }

  it("accepts an Access identity that is an active admin", async () => {
    const { email } = await createAdmin({ email: "access-admin@example.com", role: "admin" });
    const jwt = await accessJwt({ email: "Access-Admin@example.com" });
    const res = await call("/admin/me", { headers: { "cf-access-jwt-assertion": jwt } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ actor: email, via: "access", admin: { email, role: "admin" } });
  });

  it("refuses an Access identity that isn't an admin (403)", async () => {
    const jwt = await accessJwt({ email: "stranger@example.com" });
    const res = await call("/admin/me", { headers: { "cf-access-jwt-assertion": jwt } });
    expect(res.status).toBe(403);
  });

  it("refuses Access service tokens (no email)", async () => {
    const jwt = await accessJwt({ common_name: "ci.access" });
    expect((await call("/admin/me", { headers: { "cf-access-jwt-assertion": jwt } })).status).toBe(403);
  });
});

describe("security headers", () => {
  it("sets no-store and hardening headers on /auth and /admin, including errors", async () => {
    for (const res of [await call("/auth/status"), await call("/admin/me"), await adminCall("/me"), await call("/admin/nope")]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("serves the dashboard with a CSP", async () => {
    const res = await call("/settings");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("leaves protocol caching alone", async () => {
    expect((await call("/health")).headers.get("cache-control")).toBeNull();
  });
});
