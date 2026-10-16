import type { Context } from "hono";
import { getUpdate, getUpdateAssets, listUpdatesFor, toCandidate, type AssetRow } from "../db";
import type { AppEnv } from "../env";
import { currentMonth } from "../billing";
import { signerFor } from "../keys";
import { DEFAULT_APP_ID, findApp } from "../tenancy";
import { resolveUpdate } from "./resolve";
import { expoSignatureHeader, requestedKeyId, signWithKey } from "./sign";

export interface ManifestRequest {
  protocolVersion: number;
  platform: "ios" | "android";
  runtimeVersion: string;
  channel: string;
  currentUpdateId: string | null;
  embeddedUpdateId: string | null;
  expectSignature: boolean;
  /** The key id the build trusts (from expo-expect-signature), "main" by default. */
  keyId: string;
  clientId: string | null;
  acceptsMultipart: boolean;
}

export class ProtocolError extends Error {}

export function parseManifestRequest(req: Request): ManifestRequest {
  const h = req.headers;
  const url = new URL(req.url);
  const platform = h.get("expo-platform") ?? url.searchParams.get("platform");
  if (platform !== "ios" && platform !== "android") {
    throw new ProtocolError("Unsupported or missing expo-platform");
  }
  const runtimeVersion = h.get("expo-runtime-version") ?? url.searchParams.get("runtime-version");
  if (!runtimeVersion) throw new ProtocolError("Missing expo-runtime-version");
  const channel = h.get("expo-channel-name") ?? url.searchParams.get("channel");
  if (!channel) throw new ProtocolError("Missing expo-channel-name");

  const accept = h.get("accept");
  return {
    protocolVersion: Number(h.get("expo-protocol-version") ?? 0),
    platform,
    runtimeVersion,
    channel,
    currentUpdateId: h.get("expo-current-update-id"),
    embeddedUpdateId: h.get("expo-embedded-update-id"),
    expectSignature: h.has("expo-expect-signature"),
    keyId: requestedKeyId(h.get("expo-expect-signature")),
    clientId: h.get("eas-client-id"),
    acceptsMultipart: !accept || accept.includes("multipart/mixed") || accept.includes("*/*"),
  };
}

export interface Manifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, string>;
  extra: Record<string, unknown>;
}

interface ManifestAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
}

/** `assetBase` is where the app downloads files from, e.g. `https://u.example.com/app_x/assets`. */
function toManifestAsset(a: AssetRow, assetBase: string): ManifestAsset {
  return {
    hash: a.hash,
    key: a.key,
    contentType: a.content_type,
    ...(a.file_ext ? { fileExtension: a.file_ext } : {}),
    url: `${assetBase}/${a.key}`,
  };
}

export async function buildManifest(db: D1Database, updateId: string, assetBase: string): Promise<Manifest> {
  const update = await getUpdate(db, updateId);
  if (!update) throw new Error(`Update ${updateId} not found`);
  const { launch, assets } = await getUpdateAssets(db, updateId);
  return {
    id: update.id,
    createdAt: update.created_at,
    runtimeVersion: update.runtime_version,
    launchAsset: toManifestAsset(launch, assetBase),
    assets: assets.map((a) => toManifestAsset(a, assetBase)),
    metadata: JSON.parse(update.metadata_json),
    extra: JSON.parse(update.extra_json),
  };
}

export interface Part {
  name: "manifest" | "directive" | "extensions";
  body: string;
  signature?: string;
}

export function multipartBody(parts: Part[], boundary: string): string {
  const chunks = parts.map((p) => {
    const headers = [
      `content-disposition: form-data; name="${p.name}"`,
      "content-type: application/json; charset=utf-8",
      ...(p.signature ? [`expo-signature: ${p.signature}`] : []),
    ];
    return `--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n${p.body}\r\n`;
  });
  return `${chunks.join("")}--${boundary}--\r\n`;
}

const PROTOCOL_HEADERS = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
} as const;

/** `GET /:appId/manifest`: the update check for one app. */
export function handleAppManifest(c: Context<AppEnv>): Promise<Response> {
  const appId = c.req.param("appId") ?? "";
  return handleManifest(c, appId, `${new URL(c.req.url).origin}/${appId}/assets`);
}

/** `GET /manifest`: builds made before apps existed. They belong to the default app. */
export function handleLegacyManifest(c: Context<AppEnv>): Promise<Response> {
  return handleManifest(c, DEFAULT_APP_ID, `${new URL(c.req.url).origin}/assets`);
}

async function handleManifest(c: Context<AppEnv>, appId: string, assetBase: string): Promise<Response> {
  let req: ManifestRequest;
  try {
    req = parseManifestRequest(c.req.raw);
  } catch (e) {
    if (e instanceof ProtocolError) return c.json({ error: e.message }, 400);
    throw e;
  }

  // Never answer a build that expects a signature without one: it would reject it anyway.
  const sign = async (body: string): Promise<string | undefined> => {
    if (!req.expectSignature) return undefined;
    const key = await signerFor(c.env, appId, req.keyId);
    if (!key) throw new Error(`App ${appId} has no active signing key "${req.keyId}"`);
    return expoSignatureHeader(await signWithKey(body, key), req.keyId);
  };

  const rows = await listUpdatesFor(c.env.DB, appId, req);
  // Only look the app up when it has nothing published for this line: an app
  // with updates obviously exists, so the common case costs no extra query.
  if (!rows.length && !(await findApp(c.env.DB, appId))) return c.json({ error: "App not found" }, 404);
  const resolution = await resolveUpdate(rows.map(toCandidate), req);

  if (req.clientId) c.executionCtx.waitUntil(recordDevice(c.env.DB, appId, req));

  const noContent = () => new Response(null, { status: 204, headers: PROTOCOL_HEADERS });

  if (resolution.type === "update") {
    const body = JSON.stringify(await buildManifest(c.env.DB, resolution.updateId, assetBase));
    const signature = await sign(body);
    if (!req.acceptsMultipart) {
      return new Response(body, {
        headers: {
          ...PROTOCOL_HEADERS,
          "content-type": "application/expo+json",
          ...(signature ? { "expo-signature": signature } : {}),
        },
      });
    }
    return multipartResponse([
      { name: "manifest", body, signature },
      { name: "extensions", body: JSON.stringify({ assetRequestHeaders: {} }) },
    ]);
  }

  // Directives exist only in protocol 1 and only in multipart responses.
  if (req.protocolVersion < 1 || !req.acceptsMultipart) return noContent();

  const directive =
    resolution.type === "rollBackToEmbedded"
      ? { type: "rollBackToEmbedded", parameters: { commitTime: resolution.commitTime } }
      : { type: "noUpdateAvailable" };
  const body = JSON.stringify(directive);
  return multipartResponse([{ name: "directive", body, signature: await sign(body) }]);
}

function multipartResponse(parts: Part[]): Response {
  const boundary = `expo-${crypto.randomUUID()}`;
  return new Response(multipartBody(parts, boundary), {
    headers: { ...PROTOCOL_HEADERS, "content-type": `multipart/mixed; boundary=${boundary}` },
  });
}

async function recordDevice(db: D1Database, appId: string, req: ManifestRequest): Promise<void> {
  const now = new Date();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO devices (app_id, client_id, platform, runtime_version, channel, current_update_id, embedded_update_id, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (app_id, client_id) DO UPDATE SET
             platform = excluded.platform, runtime_version = excluded.runtime_version,
             channel = excluded.channel, current_update_id = excluded.current_update_id,
             embedded_update_id = excluded.embedded_update_id, last_seen = excluded.last_seen`,
        )
        .bind(
          appId,
          req.clientId,
          req.platform,
          req.runtimeVersion,
          req.channel,
          req.currentUpdateId?.toLowerCase() ?? null,
          req.embeddedUpdateId?.toLowerCase() ?? null,
          now.toISOString(),
        ),
      // Monthly active devices, for plans: one row per device per app per month.
      db
        .prepare(`INSERT OR IGNORE INTO device_months (app_id, month, client_id) VALUES (?, ?, ?)`)
        .bind(appId, currentMonth(now), req.clientId),
    ]);
  } catch (e) {
    console.error("device upsert failed", e);
  }
}
