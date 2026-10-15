import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { bytesToBase64Url, sha256 } from "../src/lib/encoding";
import {
  adminCall,
  call,
  parseMultipart,
  publish,
  requestManifest,
  uniqueChannel,
  verifyWithCertificate,
} from "./helpers";

async function getPart(res: Response, name: string) {
  const parts = await parseMultipart(res);
  const part = parts.find((p) => p.name === name);
  if (!part) throw new Error(`no ${name} part in ${parts.map((p) => p.name)}`);
  return part;
}

describe("GET /manifest", () => {
  it("serves a signed manifest with protocol headers", async () => {
    const channel = uniqueChannel();
    const { updates } = await publish({ channel, bundle: "console.log('v1')" });

    const res = await requestManifest({ channel, clientId: "device-1", currentUpdateId: "embedded-id", embeddedUpdateId: "embedded-id" });
    expect(res.status).toBe(200);
    expect(res.headers.get("expo-protocol-version")).toBe("1");
    expect(res.headers.get("expo-sfv-version")).toBe("0");
    expect(res.headers.get("cache-control")).toBe("private, max-age=0");

    const parts = await parseMultipart(res);
    expect(parts.map((p) => p.name)).toEqual(["manifest", "extensions"]);
    const manifestPart = parts[0]!;
    expect(manifestPart.headers["content-type"]).toContain("application/json");
    expect(await verifyWithCertificate(manifestPart.body, manifestPart.headers["expo-signature"]!)).toBe(true);
    expect(manifestPart.headers["expo-signature"]).toContain('keyid="main"');

    const manifest = JSON.parse(manifestPart.body);
    expect(manifest).toMatchObject({
      id: updates[0]!.id,
      runtimeVersion: "rt-1",
      metadata: {},
      extra: { expoClient: { slug: "example-app" } },
      launchAsset: { contentType: "application/javascript", fileExtension: ".bundle" },
    });
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toMatchObject({ contentType: "image/png", fileExtension: ".png" });
    expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt);

    // The launch asset URL serves bytes whose sha256 matches the manifest hash.
    expect(manifest.launchAsset.url).toBe(`https://ota.test/assets/${manifest.launchAsset.key}`);
    const asset = await call(new URL(manifest.launchAsset.url).pathname);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("content-type")).toBe("application/javascript");
    const bytes = new Uint8Array(await asset.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe("console.log('v1')");
    expect(bytesToBase64Url(await sha256(bytes))).toBe(manifest.launchAsset.hash);
  });

  it("records the device", async () => {
    const channel = uniqueChannel();
    await publish({ channel });
    await requestManifest({ channel, clientId: "device-record", currentUpdateId: "AAAA-BBBB" });
    // The upsert runs in waitUntil; poll briefly.
    let row: Record<string, unknown> | null = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await env.DB.prepare("SELECT * FROM devices WHERE client_id = ?").bind("device-record").first();
      if (!row) await new Promise((r) => setTimeout(r, 25));
    }
    expect(row).toMatchObject({ channel, platform: "android", runtime_version: "rt-1", current_update_id: "aaaa-bbbb" });
  });

  it("does not sign when the client doesn't ask", async () => {
    const channel = uniqueChannel();
    await publish({ channel });
    const part = await getPart(await requestManifest({ channel, expectSignature: false }), "manifest");
    expect(part.headers["expo-signature"]).toBeUndefined();
  });

  it("returns a signed noUpdateAvailable directive when the device is current", async () => {
    const channel = uniqueChannel();
    const { updates } = await publish({ channel });
    const part = await getPart(await requestManifest({ channel, currentUpdateId: updates[0]!.id.toUpperCase() }), "directive");
    expect(JSON.parse(part.body)).toEqual({ type: "noUpdateAvailable" });
    expect(await verifyWithCertificate(part.body, part.headers["expo-signature"]!)).toBe(true);
  });

  it("returns noUpdateAvailable for an unknown channel / runtime", async () => {
    const part = await getPart(await requestManifest({ channel: uniqueChannel() }), "directive");
    expect(JSON.parse(part.body)).toEqual({ type: "noUpdateAvailable" });
  });

  it("keeps platforms and runtimes apart", async () => {
    const channel = uniqueChannel();
    await publish({ channel, platforms: ["ios"], runtimeVersion: "rt-ios" });
    const android = await getPart(await requestManifest({ channel, platform: "android", runtimeVersion: "rt-ios" }), "directive");
    expect(JSON.parse(android.body).type).toBe("noUpdateAvailable");
    const otherRuntime = await getPart(await requestManifest({ channel, platform: "ios", runtimeVersion: "rt-2" }), "directive");
    expect(JSON.parse(otherRuntime.body).type).toBe("noUpdateAvailable");
    await getPart(await requestManifest({ channel, platform: "ios", runtimeVersion: "rt-ios" }), "manifest");
  });

  it("rejects requests missing protocol headers", async () => {
    expect((await call("/manifest", { headers: { "expo-platform": "android" } })).status).toBe(400);
    expect((await call("/manifest", { headers: { "expo-platform": "web" } })).status).toBe(400);
  });

  it("serves rollBackToEmbedded, signed, once every update is rolled back", async () => {
    const channel = uniqueChannel();
    const { updates } = await publish({ channel });
    const id = updates[0]!.id;
    const rb = await adminCall(`/updates/${id}/rollback`, { method: "POST", json: {} });
    expect(await rb.json()).toMatchObject({ results: [{ id, outcome: "embedded" }] });

    const part = await getPart(
      await requestManifest({ channel, currentUpdateId: id, embeddedUpdateId: "embedded-id" }),
      "directive",
    );
    const directive = JSON.parse(part.body);
    expect(directive.type).toBe("rollBackToEmbedded");
    expect(Date.parse(directive.parameters.commitTime)).toBeGreaterThan(0);
    expect(await verifyWithCertificate(part.body, part.headers["expo-signature"]!)).toBe(true);

    // A device already on its embedded bundle gets noUpdateAvailable.
    const embedded = await getPart(
      await requestManifest({ channel, currentUpdateId: "embedded-id", embeddedUpdateId: "embedded-id" }),
      "directive",
    );
    expect(JSON.parse(embedded.body).type).toBe("noUpdateAvailable");
  });

  it("rolling back the newest update republishes the previous one under a newer id", async () => {
    const channel = uniqueChannel();
    const first = await publish({ channel, bundle: "v1" });
    const second = await publish({ channel, bundle: "v2" });
    const rb = await adminCall(`/updates/${second.groupId}/rollback`, { method: "POST", json: {} });
    const { results } = (await rb.json()) as { results: { outcome: string; republishedId: string }[] };
    expect(results[0]!.outcome).toBe("republished");

    const part = await getPart(await requestManifest({ channel, currentUpdateId: second.updates[0]!.id }), "manifest");
    const manifest = JSON.parse(part.body);
    expect(manifest.id).toBe(results[0]!.republishedId);
    // Same bundle as the first update, but newer than the rolled-back one so clients accept it.
    const original = (await (await adminCall(`/updates/${first.updates[0]!.id}`)).json()) as {
      updates: { createdAt: string }[];
    };
    expect(manifest.createdAt > original.updates[0]!.createdAt).toBe(true);
    const bundle = await call(new URL(manifest.launchAsset.url).pathname);
    expect(await bundle.text()).toBe("v1");
  });

  it("serves a partial rollout to roughly the right share of devices", async () => {
    const channel = uniqueChannel();
    const base = await publish({ channel, bundle: "base" });
    const canary = await publish({ channel, bundle: "canary", rolloutPct: 50 });
    let canaryCount = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const part = await getPart(await requestManifest({ channel, clientId: crypto.randomUUID() }), "manifest");
      const id = JSON.parse(part.body).id;
      if (id === canary.updates[0]!.id) canaryCount++;
      else expect(id).toBe(base.updates[0]!.id);
    }
    expect(canaryCount / n).toBeGreaterThan(0.35);
    expect(canaryCount / n).toBeLessThan(0.65);
  });

  it("serves application/expo+json when multipart isn't accepted", async () => {
    const channel = uniqueChannel();
    await publish({ channel });
    const res = await call("/manifest", {
      headers: {
        accept: "application/expo+json",
        "expo-protocol-version": "1",
        "expo-platform": "android",
        "expo-runtime-version": "rt-1",
        "expo-channel-name": channel,
        "expo-expect-signature": 'sig, keyid="main"',
      },
    });
    expect(res.headers.get("content-type")).toBe("application/expo+json");
    const body = await res.text();
    expect(await verifyWithCertificate(body, res.headers.get("expo-signature")!)).toBe(true);
  });
});
