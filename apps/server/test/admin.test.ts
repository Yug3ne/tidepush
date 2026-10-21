import { describe, expect, it } from "vitest";
import { bytesToHex, sha256 } from "../src/lib/encoding";
import { ENV_TOKEN, adminCall, call, publish, requestManifest, uniqueChannel, parseMultipart } from "./helpers";

describe("admin auth", () => {
  it("rejects requests without credentials", async () => {
    expect((await call("/admin/updates")).status).toBe(401);
    expect((await call("/admin/updates", { headers: { authorization: "Bearer nope-nope-nope-nope" } })).status).toBe(
      401,
    );
    expect((await call("/admin/updates", { headers: { authorization: "Bearer tp_unknown" } })).status).toBe(401);
    // A Cloudflare Access header is not a credential here (Access belongs in front of the web app).
    expect((await call("/admin/updates", { headers: { "cf-access-jwt-assertion": "a.b.c" } })).status).toBe(401);
  });

  it("accepts a DB API token", async () => {
    const res = await adminCall("/me");
    expect(await res.json()).toEqual({ actor: "token:test", admin: null, via: "token" });
  });

  it("accepts a break-glass ADMIN_API_TOKENS entry, ignoring ones shorter than 32 chars", async () => {
    const res = await call("/admin/me", { headers: { authorization: `Bearer ${ENV_TOKEN}` } });
    expect(await res.json()).toEqual({ actor: "env-token", admin: null, via: "env-token" });
    expect((await call("/admin/me", { headers: { authorization: "Bearer short-token-0123" } })).status).toBe(401);
  });
});

describe("assets", () => {
  it("rejects uploads whose bytes don't match the key", async () => {
    const key = bytesToHex(await sha256("real"));
    const res = await adminCall(`/assets/${key}`, {
      method: "PUT",
      body: "fake",
      headers: { "content-type": "text/plain" },
    });
    expect(res.status).toBe(400);
  });

  it("reports only missing assets", async () => {
    const present = bytesToHex(await sha256("present"));
    await adminCall(`/assets/${present}`, {
      method: "PUT",
      body: "present",
      headers: { "content-type": "text/plain" },
    });
    const absent = bytesToHex(await sha256("absent"));
    const res = await adminCall("/assets/missing", { method: "POST", json: { keys: [present, absent] } });
    expect(await res.json()).toEqual({ missing: [absent] });
  });

  it("refuses to publish an update that references unknown assets", async () => {
    const res = await adminCall("/updates", {
      method: "POST",
      json: {
        channel: "production",
        updates: [{ platform: "android", runtimeVersion: "rt", launchAssetKey: "a".repeat(64), assetKeys: [] }],
      },
    });
    expect(res.status).toBe(409);
  });
});

describe("update lifecycle", () => {
  it("publishes both platforms in one group and lists them", async () => {
    const channel = uniqueChannel();
    const { groupId, updates } = await publish({ channel, platforms: ["ios", "android"] });
    expect(updates).toHaveLength(2);
    const res = await adminCall(`/updates?channel=${channel}`);
    const { updates: listed } = (await res.json()) as { updates: { groupId: string; assetCount: number }[] };
    expect(listed).toHaveLength(2);
    expect(listed.every((u) => u.groupId === groupId && u.assetCount === 2)).toBe(true);
  });

  it("promotes an update to another channel with the same assets", async () => {
    const staging = uniqueChannel();
    const production = uniqueChannel();
    const { groupId } = await publish({ channel: staging, bundle: "promote-me" });
    const res = await adminCall(`/updates/${groupId}/promote`, { method: "POST", json: { channel: production } });
    expect(res.status).toBe(201);
    const promoted = (await res.json()) as { updates: { id: string }[] };

    const parts = await parseMultipart(await requestManifest({ channel: production }));
    const manifest = JSON.parse(parts[0]!.body);
    expect(manifest.id).toBe(promoted.updates[0]!.id);
    expect(await (await call(new URL(manifest.launchAsset.url).pathname)).text()).toBe("promote-me");
  });

  it("changes rollout percentage", async () => {
    const channel = uniqueChannel();
    const { groupId, updates } = await publish({ channel, rolloutPct: 0 });
    let parts = await parseMultipart(await requestManifest({ channel, clientId: "dev-x" }));
    expect(parts[0]!.name).toBe("directive");

    await adminCall(`/updates/${groupId}/rollout`, { method: "POST", json: { pct: 100 } });
    parts = await parseMultipart(await requestManifest({ channel, clientId: "dev-x" }));
    expect(JSON.parse(parts[0]!.body).id).toBe(updates[0]!.id);
  });

  it("validates rollout input", async () => {
    const { groupId } = await publish({ channel: uniqueChannel() });
    const res = await adminCall(`/updates/${groupId}/rollout`, { method: "POST", json: { pct: 101 } });
    expect(res.status).toBe(400);
  });

  it("rollback to embedded rolls back the whole line", async () => {
    const channel = uniqueChannel();
    await publish({ channel });
    const { groupId } = await publish({ channel });
    const res = await adminCall(`/updates/${groupId}/rollback`, { method: "POST", json: { toEmbedded: true } });
    expect(res.status).toBe(200);
    const listed = (await (await adminCall(`/updates?channel=${channel}`)).json()) as { updates: { status: string }[] };
    expect(listed.updates.every((u) => u.status === "rolled_back")).toBe(true);
  });

  it("writes an audit log", async () => {
    const { groupId } = await publish({ channel: uniqueChannel() });
    const { entries } = (await (await adminCall("/audit")).json()) as {
      entries: { action: string; target: string; actor: string }[];
    };
    expect(entries.some((e) => e.action === "publish" && e.target === groupId && e.actor === "token:test")).toBe(true);
  });

  it("reports adoption stats", async () => {
    const channel = uniqueChannel();
    const { updates } = await publish({ channel });
    await requestManifest({ channel, clientId: "stats-device", currentUpdateId: updates[0]!.id });
    await new Promise((r) => setTimeout(r, 100));
    const stats = (await (await adminCall("/stats")).json()) as { byUpdate: { update_id: string; devices: number }[] };
    expect(stats.byUpdate.find((r) => r.update_id === updates[0]!.id)?.devices).toBe(1);
  });
});
