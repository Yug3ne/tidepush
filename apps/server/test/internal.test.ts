import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { INTERNAL_USER_HEADER } from "../src/internal";
import { ORIGIN, call, createAdmin } from "./helpers";

/** A request as the web app makes it, through the Internal service-binding entrypoint. */
function internalCall(userId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(INTERNAL_USER_HEADER, userId);
  return exports.Internal.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }));
}

describe("Internal entrypoint (web app)", () => {
  it("acts as the person the web app names", async () => {
    const person = await createAdmin({ role: "admin" });
    const res = await internalCall(person.id, "/admin/me");
    expect(res.status).toBe(200);
    const me = (await res.json()) as { via: string; admin: { id: string }; orgs: { id: string; role: string }[] };
    expect(me.via).toBe("internal");
    expect(me.admin.id).toBe(person.id);
    expect(me.orgs).toEqual([expect.objectContaining({ id: "org_default", role: "admin" })]);
    expect((await internalCall(person.id, "/admin/apps/app_default/updates")).status).toBe(200);
  });

  it("is ignored on the public entrypoint", async () => {
    const person = await createAdmin();
    const res = await call("/admin/me", { headers: { [INTERNAL_USER_HEADER]: person.id } });
    expect(res.status).toBe(401);
  });

  it("refuses unknown and disabled people", async () => {
    expect((await internalCall("no-such-user", "/admin/me")).status).toBe(401);
    const person = await createAdmin();
    await env.DB.prepare(`UPDATE admins SET disabled_at = ? WHERE id = ?`).bind(new Date().toISOString(), person.id).run();
    expect((await internalCall(person.id, "/admin/me")).status).toBe(401);
  });

  it("still applies org checks", async () => {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    await env.DB.prepare(`INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)`)
      .bind(`org_${suffix}`, `o-${suffix}`, "Other", new Date().toISOString())
      .run();
    const outsider = await createAdmin({ orgId: `org_${suffix}` });
    expect((await internalCall(outsider.id, "/admin/apps/app_default/updates")).status).toBe(404);
    expect((await internalCall(outsider.id, "/admin/orgs/org_default/members")).status).toBe(404);
  });

  it("doesn't need a same-origin Origin for changes (there's no browser cookie involved)", async () => {
    const person = await createAdmin({ role: "owner" });
    const res = await internalCall(person.id, "/admin/orgs/org_default/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "from-web" }),
    });
    expect(res.status).toBe(201);
  });

  it("accepts an invite addressed to the signed-in person, once", async () => {
    const owner = await createAdmin({ role: "owner" });
    const invitee = await createAdmin({ role: "member", orgId: "org_default" });
    // The invitee is already in the default org, so invite them to a new one.
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const orgId = `org_${suffix}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, 'Acme', ?)`).bind(orgId, `o-${suffix}`, new Date().toISOString()),
      env.DB.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(orgId, owner.id, new Date().toISOString()),
    ]);
    const created = await internalCall(owner.id, `/admin/orgs/${orgId}/members/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: invitee.email, role: "admin" }),
    });
    const { token } = (await created.json()) as { token: string };

    const stranger = await createAdmin();
    expect((await internalCall(stranger.id, `/admin/invites/${token}/accept`, { method: "POST" })).status).toBe(403);
    const accepted = await internalCall(invitee.id, `/admin/invites/${token}/accept`, { method: "POST" });
    expect(await accepted.json()).toEqual({ orgId, orgName: "Acme", role: "admin" });
    expect((await internalCall(invitee.id, `/admin/invites/${token}/accept`, { method: "POST" })).status).toBe(410);
    expect((await internalCall(invitee.id, `/admin/orgs/${orgId}/apps`)).status).toBe(200);
  });
});
