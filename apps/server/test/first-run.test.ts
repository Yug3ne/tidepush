import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { passwordHashOf } from "../src/auth/credentials";
import { verifyPassword } from "../src/auth/password";
import { PASSWORD, SETUP_TOKEN, call, personCall, webCall } from "./helpers";

// Each test file has its own D1, so this one starts with no admins.

const setupBody = (over: Record<string, unknown> = {}) => ({
  setupToken: SETUP_TOKEN,
  email: "  Owner@Example.COM ",
  name: "Owner",
  password: PASSWORD,
  ...over,
});

describe("first-run setup (through the web app)", () => {
  it("reports the mode and needsSetup while there are no admins", async () => {
    const res = await webCall("/auth/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "selfhost", needsSetup: true });
  });

  it("doesn't exist on the public entrypoint", async () => {
    expect((await call("/auth/status")).status).toBe(404);
    const res = await call("/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(setupBody()),
    });
    expect(res.status).toBe(404);
  });

  it("returns 503 when SETUP_TOKEN is not configured", async () => {
    const res = await webCall("/auth/setup", {
      method: "POST",
      json: setupBody(),
      env: { ...env, SETUP_TOKEN: undefined },
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("SETUP_TOKEN");
  });

  it("refuses a wrong setup token", async () => {
    const res = await webCall("/auth/setup", { method: "POST", json: setupBody({ setupToken: "wrong" }) });
    expect(res.status).toBe(401);
  });

  it("validates the body", async () => {
    expect((await webCall("/auth/setup", { method: "POST", json: setupBody({ password: "short" }) })).status).toBe(400);
    expect((await webCall("/auth/setup", { method: "POST", json: setupBody({ email: "nope" }) })).status).toBe(400);
  });

  it("creates the first owner of the default org, with a password the web app can check", async () => {
    const res = await webCall("/auth/setup", { method: "POST", json: setupBody() });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    const { admin } = (await res.json()) as { admin: { id: string; email: string; role: string; name: string } };
    expect(admin).toMatchObject({ email: "owner@example.com", role: "owner", name: "Owner" });

    // Better Auth (the web app) signs them in against this hash.
    expect(await verifyPassword(PASSWORD, (await passwordHashOf(env.DB, admin.id))!)).toBe(true);

    const me = await personCall("/admin/me", admin.id);
    expect(await me.json()).toMatchObject({
      actor: "owner@example.com",
      via: "internal",
      admin: { role: "owner" },
      orgs: [expect.objectContaining({ id: "org_default", role: "owner" })],
    });
    expect(await (await webCall("/auth/status")).json()).toEqual({ mode: "selfhost", needsSetup: false });

    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action = 'setup'`).first();
    expect(audit).toMatchObject({ actor: "owner@example.com" });
  });

  it("is closed for good once an owner exists", async () => {
    const res = await webCall("/auth/setup", { method: "POST", json: setupBody({ email: "second@example.com" }) });
    expect(res.status).toBe(409);
    const { n } = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>())!;
    expect(n).toBe(1);
  });
});
