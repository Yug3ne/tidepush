import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashToken } from "../src/auth/tokens";
import { FREE_PLAN, GRACE_DAYS, assertCanPublish, currentMonth, usageReport } from "../src/billing";
import { bytesToHex, sha256 } from "../src/lib/encoding";
import app from "../src/index";
import { ORIGIN, createAdmin, personCall } from "./helpers";

/** The deployment as the hosted service runs it. */
const hosted = { ...env, TIDEPUSH_MODE: "hosted" };

/** A call to the hosted deployment: with an API token, or as a person through the web app (`as`). */
async function hostedCall(path: string, init: RequestInit & { json?: unknown; token?: string; as?: string } = {}) {
  const { token, as, ...rest } = init;
  if (as) return personCall(path, as, { ...rest, env: hosted });
  const headers = new Headers(rest.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  let body = rest.body;
  if (rest.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(rest.json);
  }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers, body }), hosted, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function freeOrg() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const orgId = `org_${suffix}`;
  const appId = `app_${suffix}`;
  const token = `tp_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO orgs (id, slug, name, plan, created_at) VALUES (?, ?, 'Org', 'free', ?)`).bind(orgId, `o-${suffix}`, now),
    env.DB.prepare(`INSERT INTO apps (id, org_id, name, created_at) VALUES (?, ?, 'App', ?)`).bind(appId, orgId, now),
    env.DB.prepare(
      `INSERT INTO api_tokens (id, org_id, name, token_hash, prefix, created_by, created_at) VALUES (?, ?, 'ci', ?, 'x', 'test', ?)`,
    ).bind(crypto.randomUUID(), orgId, await hashToken(token), now),
  ]);
  return { orgId, appId, token };
}

/** Adds `n` devices this month directly (as if they had checked in). */
async function addDevices(appId: string, n: number, month = currentMonth()) {
  const statements = Array.from({ length: n }, (_, i) =>
    env.DB.prepare(`INSERT INTO device_months (app_id, month, client_id) VALUES (?, ?, ?)`).bind(appId, month, `c-${i}`),
  );
  for (let i = 0; i < statements.length; i += 500) await env.DB.batch(statements.slice(i, i + 500));
}

async function publishTo(org: { appId: string; token: string }) {
  const bytes = new TextEncoder().encode(`bundle-${crypto.randomUUID()}`);
  const key = bytesToHex(await sha256(bytes));
  await hostedCall(`/admin/apps/${org.appId}/assets/${key}`, {
    method: "PUT",
    body: bytes,
    token: org.token,
    headers: { "content-type": "application/javascript" },
  });
  return hostedCall(`/admin/apps/${org.appId}/updates`, {
    method: "POST",
    token: org.token,
    json: { channel: "production", updates: [{ platform: "android", runtimeVersion: "rt-1", launchAssetKey: key, assetKeys: [] }] },
  });
}

const manifest = (appId: string, clientId: string) =>
  hostedCall(`/${appId}/manifest`, {
    headers: {
      accept: "multipart/mixed",
      "expo-protocol-version": "1",
      "expo-platform": "android",
      "expo-runtime-version": "rt-1",
      "expo-channel-name": "production",
      "eas-client-id": clientId,
    },
  });

describe("monthly active devices", () => {
  it("count each device once per app per month", async () => {
    const org = await freeOrg();
    for (const id of ["a", "a", "b"]) await manifest(org.appId, id);
    const report = await usageReport(hosted, org.orgId);
    expect(report.usage.monthlyActiveDevices).toBe(2);
    expect(report.usage.month).toBe(currentMonth());
  });
});

describe("plans", () => {
  it("has no limits when self-hosted", async () => {
    const org = await freeOrg();
    await addDevices(org.appId, FREE_PLAN.monthlyActiveDevices + 1);
    const report = await usageReport(env, org.orgId);
    expect(report).toMatchObject({ plan: "selfhost", limits: null, over: [], publishingPaused: false });
  });

  it("gives unsubscribed orgs the free plan, and subscribed ones no limits", async () => {
    const org = await freeOrg();
    expect(await usageReport(hosted, org.orgId)).toMatchObject({ plan: "free", subscribed: false, limits: FREE_PLAN });
    await env.DB.prepare(`UPDATE orgs SET subscribed = 1 WHERE id = ?`).bind(org.orgId).run();
    expect(await usageReport(hosted, org.orgId)).toMatchObject({ plan: "subscribed", subscribed: true, limits: null });
  });

  it("pauses publishing only after the grace period, and never stops phones", async () => {
    const org = await freeOrg();
    expect((await publishTo(org)).status).toBe(201);

    await addDevices(org.appId, FREE_PLAN.monthlyActiveDevices + 1);
    // Over the limit: the grace period starts, publishing still works.
    expect((await publishTo(org)).status).toBe(201);
    const report = await usageReport(hosted, org.orgId);
    expect(report.over).toEqual(["monthlyActiveDevices"]);
    expect(report.overLimitSince).not.toBeNull();
    expect(report.publishingPaused).toBe(false);

    // After the grace period: publishing is refused.
    const longAgo = new Date(Date.now() - (GRACE_DAYS + 1) * 86_400_000).toISOString();
    await env.DB.prepare(`UPDATE orgs SET over_limit_since = ? WHERE id = ?`).bind(longAgo, org.orgId).run();
    const refused = await publishTo(org);
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Phones still get updates/);
    expect((await usageReport(hosted, org.orgId)).publishingPaused).toBe(true);

    // Phones still get the published update.
    const res = await manifest(org.appId, "phone-1");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="manifest"');

    // Subscribing lifts it straight away.
    await env.DB.prepare(`UPDATE orgs SET subscribed = 1 WHERE id = ?`).bind(org.orgId).run();
    expect((await publishTo(org)).status).toBe(201);
  });

  it("forgets the grace period once usage is back under the limit", async () => {
    const org = await freeOrg();
    await env.DB.prepare(`UPDATE orgs SET over_limit_since = ? WHERE id = ?`).bind(new Date().toISOString(), org.orgId).run();
    await assertCanPublish(hosted, org.orgId);
    const row = await env.DB.prepare(`SELECT over_limit_since FROM orgs WHERE id = ?`).bind(org.orgId).first();
    expect(row).toEqual({ over_limit_since: null });
  });

  it("counts last month's devices toward last month only", async () => {
    const org = await freeOrg();
    await addDevices(org.appId, FREE_PLAN.monthlyActiveDevices + 1, "2020-01");
    expect((await usageReport(hosted, org.orgId)).over).toEqual([]);
  });

  it("limits apps and members on the free plan", async () => {
    const org = await freeOrg();
    const owner = await createAdmin({ role: "owner", orgId: org.orgId });

    const extraApp = await hostedCall(`/admin/orgs/${org.orgId}/apps`, { method: "POST", as: owner.id, json: { name: "Second" } });
    expect(extraApp.status).toBe(402);

    // 1 member now; the free plan has room for 2 more (pending invites count).
    for (let i = 0; i < FREE_PLAN.members - 1; i++) {
      const ok = await hostedCall(`/admin/orgs/${org.orgId}/members/invites`, {
        method: "POST",
        as: owner.id,
        json: { email: `p${i}-${org.orgId}@example.com`, role: "member" },
      });
      expect(ok.status).toBe(201);
    }
    const full = await hostedCall(`/admin/orgs/${org.orgId}/members/invites`, {
      method: "POST",
      as: owner.id,
      json: { email: `over-${org.orgId}@example.com`, role: "member" },
    });
    expect(full.status).toBe(402);

    const usage = (await (await hostedCall(`/admin/orgs/${org.orgId}/usage`, { as: owner.id })).json()) as { usage: { apps: number; members: number } };
    expect(usage.usage).toMatchObject({ apps: 1, members: FREE_PLAN.members });
  });
});

describe("archiving apps", () => {
  it("frees the free plan's app slot, keeps serving phones, and won't unarchive past the limit", async () => {
    const org = await freeOrg();
    const owner = await createAdmin({ role: "owner", orgId: org.orgId });
    const archive = await hostedCall(`/admin/orgs/${org.orgId}/apps/${org.appId}`, { method: "PATCH", as: owner.id, json: { archived: true } });
    expect(((await archive.json()) as { archived: boolean }).archived).toBe(true);
    expect((await manifest(org.appId, "still-here")).status).toBe(200);

    const second = await hostedCall(`/admin/orgs/${org.orgId}/apps`, { method: "POST", as: owner.id, json: { name: "Second" } });
    expect(second.status).toBe(201);
    const back = await hostedCall(`/admin/orgs/${org.orgId}/apps/${org.appId}`, { method: "PATCH", as: owner.id, json: { archived: false } });
    expect(back.status).toBe(402);
  });
});

describe("removing members on the hosted service", () => {
  it("keeps their account (they made it), but takes the org away", async () => {
    const org = await freeOrg();
    const owner = await createAdmin({ role: "owner", orgId: org.orgId });
    const member = await createAdmin({ role: "member", orgId: org.orgId });
    const removed = await hostedCall(`/admin/orgs/${org.orgId}/members/${member.id}`, { method: "DELETE", as: owner.id });
    expect(removed.status).toBe(204);
    const row = await env.DB.prepare(`SELECT disabled_at FROM admins WHERE id = ?`).bind(member.id).first();
    expect(row).toEqual({ disabled_at: null });
    expect(await env.DB.prepare(`SELECT 1 FROM memberships WHERE user_id = ?`).bind(member.id).first()).toBeNull();
  });
});

describe("organizations", () => {
  it("are created by signed-in people in hosted mode, who become owners", async () => {
    const person = await createAdmin({ role: "member" });
    const res = await hostedCall("/admin/orgs", { method: "POST", as: person.id, json: { name: "Acme Mobile" } });
    expect(res.status).toBe(201);
    const org = (await res.json()) as { id: string; slug: string; role: string };
    expect(org.slug).toMatch(/^acme-mobile-[a-z0-9]{6}$/);
    expect(org.role).toBe("owner");
    expect((await hostedCall(`/admin/orgs/${org.id}/usage`, { as: person.id })).status).toBe(200);
  });

  it("can't be created on a self-hosted server, or with a token", async () => {
    const person = await createAdmin();
    const selfHosted = await personCall("/admin/orgs", person.id, { method: "POST", json: { name: "X" } });
    expect(selfHosted.status).toBe(403);
    const org = await freeOrg();
    expect((await hostedCall("/admin/orgs", { method: "POST", token: org.token, json: { name: "X" } })).status).toBe(403);
  });
});
