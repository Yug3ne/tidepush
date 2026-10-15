import type { Context } from "hono";
import { getUpdate, getUpdateAssets, listUpdatesFor, toCandidate, type AssetRow } from "../db";
import type { AppEnv } from "../env";
import { resolveUpdate } from "./resolve";
import { expoSignatureHeader, signBody } from "./sign";

export interface ManifestRequest {
  protocolVersion: number;
  platform: "ios" | "android";
  runtimeVersion: string;
  channel: string;
  currentUpdateId: string | null;
  embeddedUpdateId: string | null;
  expectSignature: boolean;
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

function toManifestAsset(a: AssetRow, origin: string): ManifestAsset {
  return {
    hash: a.hash,
    key: a.key,
    contentType: a.content_type,
    ...(a.file_ext ? { fileExtension: a.file_ext } : {}),
    url: `${origin}/assets/${a.key}`,
  };
}

export async function buildManifest(db: D1Database, updateId: string, origin: string): Promise<Manifest> {
  const update = await getUpdate(db, updateId);
  if (!update) throw new Error(`Update ${updateId} not found`);
  const { launch, assets } = await getUpdateAssets(db, updateId);
  return {
    id: update.id,
    createdAt: update.created_at,
    runtimeVersion: update.runtime_version,
    launchAsset: toManifestAsset(launch, origin),
    assets: assets.map((a) => toManifestAsset(a, origin)),
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

export async function handleManifest(c: Context<AppEnv>): Promise<Response> {
  let req: ManifestRequest;
  try {
    req = parseManifestRequest(c.req.raw);
  } catch (e) {
    if (e instanceof ProtocolError) return c.json({ error: e.message }, 400);
    throw e;
  }

  const sign = async (body: string): Promise<string | undefined> => {
    if (!req.expectSignature) return undefined;
    const pem = c.env.CODE_SIGNING_PRIVATE_KEY;
    if (!pem) throw new Error("Client expects a signature but CODE_SIGNING_PRIVATE_KEY is not set");
    return expoSignatureHeader(await signBody(body, pem), c.env.CODE_SIGNING_KEY_ID);
  };

  const rows = await listUpdatesFor(c.env.DB, req);
  const resolution = await resolveUpdate(rows.map(toCandidate), req);

  if (req.clientId) c.executionCtx.waitUntil(recordDevice(c.env.DB, req));

  const noContent = () => new Response(null, { status: 204, headers: PROTOCOL_HEADERS });

  if (resolution.type === "update") {
    const origin = new URL(c.req.url).origin;
    const body = JSON.stringify(await buildManifest(c.env.DB, resolution.updateId, origin));
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

async function recordDevice(db: D1Database, req: ManifestRequest): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO devices (client_id, platform, runtime_version, channel, current_update_id, embedded_update_id, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (client_id) DO UPDATE SET
           platform = excluded.platform, runtime_version = excluded.runtime_version,
           channel = excluded.channel, current_update_id = excluded.current_update_id,
           embedded_update_id = excluded.embedded_update_id, last_seen = excluded.last_seen`,
      )
      .bind(
        req.clientId,
        req.platform,
        req.runtimeVersion,
        req.channel,
        req.currentUpdateId?.toLowerCase() ?? null,
        req.embeddedUpdateId?.toLowerCase() ?? null,
        new Date().toISOString(),
      )
      .run();
  } catch (e) {
    console.error("device upsert failed", e);
  }
}
