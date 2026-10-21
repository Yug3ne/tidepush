import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { passwordHashOf } from "../src/auth/credentials";
import { verifyPassword } from "../src/auth/password";
import { hashToken } from "../src/auth/tokens";
import app from "../src/index";
import { ENV_TOKEN, ORIGIN, PASSWORD, adminCall, call, createAdmin, personCall, signedIn, webCall } from "./helpers";

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const auditActions = async (action: string) =>
  (await env.DB.prepare(`SELECT * FROM audit_log WHERE action = ?`).bind(action).all()).results;

describe("team", () => {
  it("is owner-only", async () => {
    const { id } = await signedIn("admin");
    expect((await personCall("/admin/admins", id)).status).toBe(403);
    expect(
      (
        await personCall("/admin/admins/invites", id, {
          method: "POST",
          json: { email: "x@example.com", role: "admin" },
        })
      ).status,
    ).toBe(403);
    const victim = await createAdmin();
    expect((await personCall(`/admin/admins/${victim.id}`, id, { method: "DELETE" })).status).toBe(403);
    // API tokens are not people, so they can't manage the team either.
    expect((await adminCall("/admins")).status).toBe(403);
    // But admins can still do everything else.
    expect((await personCall("/admin/updates", id)).status).toBe(200);
  });

  it("invites an admin: view, accept (signed in), single use", async () => {
    const owner = await signedIn();
    const res = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: "New.Person@Example.com", role: "admin" },
    });
    expect(res.status).toBe(201);
    const { inviteUrl, expiresAt } = await json<{ inviteUrl: string; expiresAt: string }>(res);
    expect(inviteUrl).toMatch(new RegExp(`^${ORIGIN}/invite/[A-Za-z0-9_-]{43}$`));
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(71 * 3600_000);
    const token = inviteUrl.split("/").pop()!;

    const team = await json<{ invites: { email: string }[] }>(await personCall("/admin/admins", owner.id));
    expect(team.invites.map((i) => i.email)).toContain("new.person@example.com");

    const view = await webCall(`/auth/invites/${token}`);
    expect(view.status).toBe(200);
    expect(await json(view)).toEqual({
      email: "new.person@example.com",
      role: "admin",
      orgName: "Default",
      expiresAt,
      hasAccount: false,
    });

    const accept = await webCall(`/auth/invites/${token}/accept`, {
      method: "POST",
      json: { name: "New Person", password: PASSWORD },
    });
    expect(accept.status).toBe(201);
    expect(await json(accept)).toEqual({ orgId: "org_default", email: "new.person@example.com", role: "admin" });
    expect(accept.headers.get("set-cookie")).toBeNull();
    // The web app signs them in with that password (Better Auth, same account table).
    const person = await env.DB.prepare(`SELECT id, name, email_verified FROM admins WHERE email = ?`)
      .bind("new.person@example.com")
      .first<{ id: string; name: string; email_verified: number }>();
    expect(person).toMatchObject({ name: "New Person", email_verified: 1 });
    expect(await verifyPassword(PASSWORD, (await passwordHashOf(env.DB, person!.id))!)).toBe(true);
    expect(await json(await personCall("/admin/me", person!.id))).toMatchObject({
      actor: "new.person@example.com",
      via: "internal",
    });

    expect((await webCall(`/auth/invites/${token}`)).status).toBe(410);
    const again = await webCall(`/auth/invites/${token}/accept`, {
      method: "POST",
      json: { name: "Someone Else", password: PASSWORD },
    });
    expect(again.status).toBe(410);
    expect(await auditActions("invite_accept")).toHaveLength(1);
    expect(await auditActions("invite")).toHaveLength(1);
  });

  it("links invites to the web app's own URL when WEB_URL isn't set", async () => {
    const owner = await signedIn();
    const res = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: "linked@example.com", role: "member" },
      webUrl: "https://dash.example.com/",
    });
    expect((await json<{ inviteUrl: string }>(res)).inviteUrl).toMatch(
      /^https:\/\/dash\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/,
    );
  });

  it("needs a name and a password to create the account", async () => {
    const owner = await signedIn();
    const res = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: "half@example.com", role: "member" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    expect((await webCall(`/auth/invites/${token}/accept`, { method: "POST", json: {} })).status).toBe(400);
    expect(
      (await webCall(`/auth/invites/${token}/accept`, { method: "POST", json: { name: "Half", password: "short" } }))
        .status,
    ).toBe(400);
    // Still usable after the failed attempts.
    expect((await webCall(`/auth/invites/${token}`)).status).toBe(200);
  });

  it("rejects expired and unknown invites", async () => {
    const owner = await signedIn();
    const res = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: "late@example.com", role: "admin" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    await env.DB.prepare(`UPDATE invites SET expires_at = ? WHERE token_hash = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), await hashToken(token))
      .run();
    expect((await webCall(`/auth/invites/${token}`)).status).toBe(410);
    const accept = await webCall(`/auth/invites/${token}/accept`, {
      method: "POST",
      json: { name: "Late", password: PASSWORD },
    });
    expect(accept.status).toBe(410);
    expect((await webCall(`/auth/invites/not-a-real-token`)).status).toBe(404);
  });

  it("refuses to invite an existing admin, and revokes pending invites", async () => {
    const owner = await signedIn();
    const existing = await createAdmin();
    const dup = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: existing.email, role: "admin" },
    });
    expect(dup.status).toBe(409);

    const res = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: "revoke-me@example.com", role: "owner" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    const del = await personCall("/admin/admins/invites/revoke-me@example.com", owner.id, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await webCall(`/auth/invites/${token}`)).status).toBe(404);
    expect(
      (await personCall("/admin/admins/invites/revoke-me@example.com", owner.id, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("removes an admin: disables them and ends their sessions", async () => {
    const owner = await signedIn();
    const victim = await signedIn("admin");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        victim.id,
        crypto.randomUUID(),
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      )
      .run();
    const res = await personCall(`/admin/admins/${victim.id}`, owner.id, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await personCall("/admin/me", victim.id)).status).toBe(401);
    // They leave the org's member list, and with no org left their account is disabled.
    const team = await json<{ admins: { id: string }[] }>(await personCall("/admin/admins", owner.id));
    expect(team.admins.find((a) => a.id === victim.id)).toBeUndefined();
    const row = await env.DB.prepare(`SELECT disabled_at FROM admins WHERE id = ?`)
      .bind(victim.id)
      .first<{ disabled_at: string | null }>();
    expect(row?.disabled_at).not.toBeNull();
    // Their web app (Better Auth) sessions end too.
    expect(await env.DB.prepare(`SELECT 1 FROM auth_session WHERE user_id = ?`).bind(victim.id).first()).toBeNull();
    expect((await personCall(`/admin/admins/${victim.id}`, owner.id, { method: "DELETE" })).status).toBe(404);
    expect(await auditActions("admin_remove")).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor: owner.email, target: victim.email })]),
    );
  });

  it("refuses to remove yourself, so the last owner always stays", async () => {
    const owner = await signedIn();
    expect((await personCall(`/admin/admins/${owner.id}`, owner.id, { method: "DELETE" })).status).toBe(400);

    // Owners can remove other owners; the caller (an owner) always remains.
    const other = await createAdmin({ role: "owner" });
    expect((await personCall(`/admin/admins/${other.id}`, owner.id, { method: "DELETE" })).status).toBe(204);
    const self = await env.DB.prepare(`SELECT disabled_at FROM admins WHERE id = ?`).bind(owner.id).first();
    expect(self).toEqual({ disabled_at: null });
  });

  it("lets a removed admin be invited back", async () => {
    const owner = await signedIn();
    const victim = await createAdmin({ email: "comeback@example.com", role: "admin" });
    await personCall(`/admin/admins/${victim.id}`, owner.id, { method: "DELETE" });
    const res = await personCall("/admin/admins/invites", owner.id, {
      method: "POST",
      json: { email: "comeback@example.com", role: "admin" },
    });
    const token = (await json<{ inviteUrl: string }>(res)).inviteUrl.split("/").pop()!;
    // Disabled accounts count as no account: the invite page asks for a name and a new password.
    expect(await json(await webCall(`/auth/invites/${token}`))).toMatchObject({ hasAccount: false });
    const accept = await webCall(`/auth/invites/${token}/accept`, {
      method: "POST",
      json: { name: "Back Again", password: "a completely new password" },
    });
    expect(accept.status).toBe(201);
    const row = await env.DB.prepare(`SELECT name, disabled_at FROM admins WHERE id = ?`).bind(victim.id).first();
    expect(row).toEqual({ name: "Back Again", disabled_at: null });
    expect(await verifyPassword("a completely new password", (await passwordHashOf(env.DB, victim.id))!)).toBe(true);
    expect((await personCall("/admin/me", victim.id)).status).toBe(200);
  });
});

describe("API tokens", () => {
  it("creates (plaintext once), uses, lists and revokes a token", async () => {
    const { id, email } = await signedIn("admin");
    const res = await personCall("/admin/tokens", id, { method: "POST", json: { name: "ci" } });
    expect(res.status).toBe(201);
    const created = await json<{ token: string; id: string; name: string; prefix: string }>(res);
    expect(created.token).toMatch(/^tp_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(3, 11));

    // Stored hashed only.
    const row = await env.DB.prepare(`SELECT * FROM api_tokens WHERE id = ?`)
      .bind(created.id)
      .first<Record<string, string>>();
    expect(row!.token_hash).toBe(await hashToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const bearer = { authorization: `Bearer ${created.token}` };
    const me = await call("/admin/me", { headers: bearer });
    expect(await json(me)).toEqual({ actor: "token:ci", admin: null, via: "token" });

    const list = await json<{ tokens: Record<string, unknown>[] }>(await personCall("/admin/tokens", id));
    const listed = list.tokens.find((t) => t.id === created.id)!;
    expect(listed).toMatchObject({ name: "ci", prefix: created.prefix, createdBy: email });
    expect(listed.lastUsedAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain(created.token);

    expect((await personCall(`/admin/tokens/${created.id}`, id, { method: "DELETE" })).status).toBe(204);
    expect((await call("/admin/me", { headers: bearer })).status).toBe(401);
    const after = await json<{ tokens: { id: string }[] }>(await personCall("/admin/tokens", id));
    expect(after.tokens.some((t) => t.id === created.id)).toBe(false);
    expect((await personCall(`/admin/tokens/${created.id}`, id, { method: "DELETE" })).status).toBe(404);

    expect(await auditActions("token_create")).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor: email, target: created.id })]),
    );
    expect(await auditActions("token_revoke")).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: created.id })]),
    );
  });

  it("can't be managed with an API token", async () => {
    expect((await adminCall("/tokens")).status).toBe(403);
    expect((await adminCall("/tokens", { method: "POST", json: { name: "x" } })).status).toBe(403);
    expect((await call("/admin/tokens", { headers: { authorization: `Bearer ${ENV_TOKEN}` } })).status).toBe(403);
  });
});

describe("the API Worker's own address", () => {
  it("has no dashboard or sign-in of its own (the web app is the dashboard)", async () => {
    for (const path of ["/settings", "/login", "/setup", "/index.html"]) {
      const res = await call(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    const login = await call("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "x@example.com", password: PASSWORD }),
    });
    expect(login.status).toBe(404);
    expect((await adminCall("/me/password", { method: "POST", json: {} })).status).toBe(404);
  });

  it("sends / to the web app when WEB_URL is set", async () => {
    expect((await call("/")).status).toBe(404);
    const res = await app.fetch(
      new Request(`${ORIGIN}/`),
      { ...env, WEB_URL: "https://dash.example.com" },
      createExecutionContext(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://dash.example.com");
  });
});

describe("security headers", () => {
  it("sets no-store and hardening headers on /auth and /admin, including errors", async () => {
    for (const res of [
      await webCall("/auth/status"),
      await call("/auth/status"),
      await call("/admin/me"),
      await adminCall("/me"),
      await call("/admin/nope"),
    ]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("leaves protocol caching alone", async () => {
    expect((await call("/health")).headers.get("cache-control")).toBeNull();
  });
});
