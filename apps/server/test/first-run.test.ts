import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { ORIGIN, PASSWORD, SETUP_TOKEN, browserCall, call, cookieFrom } from "./helpers";

// Each test file has its own D1, so this one starts with no admins.

const setupBody = (over: Record<string, unknown> = {}) => ({
  setupToken: SETUP_TOKEN,
  email: "  Owner@Example.COM ",
  name: "Owner",
  password: PASSWORD,
  ...over,
});

describe("first-run setup", () => {
  it("reports needsSetup while there are no admins", async () => {
    const res = await call("/auth/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: true, admin: null });
  });

  it("returns 503 when SETUP_TOKEN is not configured", async () => {
    const req = new Request(`${ORIGIN}/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(setupBody()),
    });
    const res = await app.fetch(req, { ...env, SETUP_TOKEN: undefined }, createExecutionContext());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("SETUP_TOKEN");
  });

  it("refuses a wrong setup token", async () => {
    const res = await browserCall("/auth/setup", null, { method: "POST", json: setupBody({ setupToken: "wrong" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("validates the body", async () => {
    const short = await browserCall("/auth/setup", null, { method: "POST", json: setupBody({ password: "short" }) });
    expect(short.status).toBe(400);
    const badEmail = await browserCall("/auth/setup", null, { method: "POST", json: setupBody({ email: "nope" }) });
    expect(badEmail.status).toBe(400);
  });

  it("creates the first owner and signs them in", async () => {
    const res = await browserCall("/auth/setup", null, { method: "POST", json: setupBody() });
    expect(res.status).toBe(201);
    const { admin } = (await res.json()) as { admin: { email: string; role: string; name: string } };
    expect(admin).toMatchObject({ email: "owner@example.com", role: "owner", name: "Owner" });

    const cookie = cookieFrom(res);
    const status = await browserCall("/auth/status", cookie);
    expect(await status.json()).toMatchObject({ needsSetup: false, admin: { email: "owner@example.com", role: "owner" } });

    const me = await browserCall("/admin/me", cookie);
    expect(await me.json()).toMatchObject({ actor: "owner@example.com", via: "session", admin: { role: "owner" } });

    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action = 'setup'`).first();
    expect(audit).toMatchObject({ actor: "owner@example.com" });
  });

  it("is closed for good once an owner exists", async () => {
    const res = await browserCall("/auth/setup", null, {
      method: "POST",
      json: setupBody({ email: "second@example.com" }),
    });
    expect(res.status).toBe(409);
    const { n } = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>())!;
    expect(n).toBe(1);
  });
});
