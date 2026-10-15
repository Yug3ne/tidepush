import { env, exports } from "cloudflare:workers";
import { hashPassword } from "../src/auth/password";
import { base64ToBytes, bytesToHex, sha256 } from "../src/lib/encoding";

export const ORIGIN = "https://ota.test";
/** A DB API token, seeded by setup.ts (actor `token:test`). */
export const TOKEN = "tp_testtoken0123456789abcdefghijklmnopqrstuv";
/** A break-glass ADMIN_API_TOKENS entry (see vitest.config.ts). */
export const ENV_TOKEN = "env-break-glass-token-0123456789abcdef";
export const SETUP_TOKEN = "test-setup-token-0123456789abcdef0123456789";
export const PASSWORD = "correct horse battery staple";

export function call(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

type CallInit = RequestInit & { json?: unknown };

function withJson(init: CallInit, headers: Headers): RequestInit {
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  return { ...init, headers, body };
}

/** An /admin call with the seeded API token. */
export function adminCall(path: string, init: CallInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  return call(`/admin${path}`, withJson(init, headers));
}

/** A same-origin browser call with a session cookie (the dashboard's view). */
export function browserCall(path: string, cookie: string | null, init: CallInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  return call(path, withJson(init, headers));
}

/** `name=value` from a response's Set-Cookie, ready for a Cookie header. */
export function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`no set-cookie (status ${res.status})`);
  return setCookie.split(";")[0]!;
}

type Role = "owner" | "admin" | "member";

/** Inserts a person directly, as a member of `orgId` (the default org unless given). Returns their id. */
export async function createAdmin(
  opts: { email?: string; role?: Role; password?: string; name?: string; orgId?: string } = {},
) {
  const id = crypto.randomUUID();
  const email = opts.email ?? `${id.slice(0, 8)}@example.com`;
  const role = opts.role ?? "owner";
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO admins (id, email, name, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(id, email, opts.name ?? "Test Admin", now, now),
    env.DB.prepare(
      `INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?1, ?2, ?2, 'credential', ?3, ?4, ?4)`,
    ).bind(crypto.randomUUID(), id, await hashPassword(opts.password ?? PASSWORD), now),
    env.DB.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`).bind(
      opts.orgId ?? "org_default",
      id,
      role,
      now,
    ),
  ]);
  return { id, email };
}

/** Signs in through /auth/login and returns the session cookie. */
export async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await browserCall("/auth/login", null, { method: "POST", json: { email, password } });
  if (res.status !== 200) throw new Error(`login failed ${res.status}: ${await res.text()}`);
  return cookieFrom(res);
}

/** A fresh admin of the given role, signed in. */
export async function signedIn(role: Role = "owner", orgId?: string) {
  const admin = await createAdmin({ role, orgId });
  return { ...admin, cookie: await login(admin.email) };
}

export interface ManifestHeaders {
  platform?: string;
  runtimeVersion?: string;
  channel?: string;
  currentUpdateId?: string;
  embeddedUpdateId?: string;
  clientId?: string;
  expectSignature?: boolean;
}

export function requestManifest(h: ManifestHeaders = {}): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "multipart/mixed,application/expo+json,application/json",
    "expo-protocol-version": "1",
    "expo-platform": h.platform ?? "android",
    "expo-runtime-version": h.runtimeVersion ?? "rt-1",
    "expo-channel-name": h.channel ?? "production",
  };
  if (h.currentUpdateId) headers["expo-current-update-id"] = h.currentUpdateId;
  if (h.embeddedUpdateId) headers["expo-embedded-update-id"] = h.embeddedUpdateId;
  if (h.clientId) headers["eas-client-id"] = h.clientId;
  if (h.expectSignature !== false) headers["expo-expect-signature"] = 'sig, keyid="main", alg="rsa-v1_5-sha256"';
  return call("/manifest", { headers });
}

export interface ParsedPart {
  name: string;
  headers: Record<string, string>;
  body: string;
}

/** Minimal multipart/mixed parser, mirroring what expo-updates does with the response. */
export async function parseMultipart(res: Response): Promise<ParsedPart[]> {
  const boundary = res.headers.get("content-type")?.match(/boundary=([^;]+)/)?.[1];
  if (!boundary) throw new Error(`not multipart: ${res.headers.get("content-type")}`);
  const text = new TextDecoder().decode(await res.arrayBuffer());
  const [, ...rest] = text.split(`--${boundary}`);
  return rest
    .filter((chunk) => !chunk.startsWith("--"))
    .map((chunk) => {
      const raw = chunk.replace(/^\r\n/, "").replace(/\r\n$/, "");
      const split = raw.indexOf("\r\n\r\n");
      const headers: Record<string, string> = {};
      for (const line of raw.slice(0, split).split("\r\n")) {
        const i = line.indexOf(":");
        headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      const name = headers["content-disposition"]?.match(/name="([^"]+)"/)?.[1] ?? "";
      return { name, headers, body: raw.slice(split + 4) };
    });
}

// ---- Signature verification against the app's X.509 certificate -----------

function readTlv(der: Uint8Array, offset: number) {
  const tag = der[offset]!;
  let len = der[offset + 1]!;
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | der[offset + 2 + i]!;
    header += n;
  }
  return { tag, start: offset, contentStart: offset + header, end: offset + header + len };
}

function children(der: Uint8Array, parent: { contentStart: number; end: number }) {
  const out = [];
  for (let o = parent.contentStart; o < parent.end; ) {
    const tlv = readTlv(der, o);
    out.push(tlv);
    o = tlv.end;
  }
  return out;
}

/** Pulls SubjectPublicKeyInfo out of a PEM certificate, the way the client does. */
export async function publicKeyFromCertificate(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const der = base64ToBytes(b64);
  const cert = readTlv(der, 0);
  const tbs = children(der, cert)[0]!;
  const fields = children(der, tbs);
  const offset = fields[0]!.tag === 0xa0 ? 1 : 0; // explicit [0] version
  const spki = fields[offset + 5]!;
  return crypto.subtle.importKey(
    "spki",
    der.slice(spki.start, spki.end),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export function parseSignatureHeader(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.trim().split(/=(.*)/s);
      return [k!, v!.replace(/^"|"$/g, "")];
    }),
  );
}

export async function verifyWithCertificate(body: string, signatureHeader: string): Promise<boolean> {
  const { sig } = parseSignatureHeader(signatureHeader);
  const key = await publicKeyFromCertificate(env.TEST_CERTIFICATE);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64ToBytes(sig!), new TextEncoder().encode(body));
}

// ---- Publishing ------------------------------------------------------------

export async function uploadAsset(content: string, contentType: string, ext: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const key = bytesToHex(await sha256(bytes));
  const res = await adminCall(`/assets/${key}`, {
    method: "PUT",
    body: bytes,
    headers: { "content-type": contentType, "x-file-extension": ext },
  });
  if (res.status !== 201) throw new Error(`upload failed ${res.status}: ${await res.text()}`);
  return key;
}

export async function publish(opts: {
  channel?: string;
  runtimeVersion?: string;
  platforms?: ("ios" | "android")[];
  rolloutPct?: number;
  bundle?: string;
  message?: string;
}): Promise<{ groupId: string; updates: { id: string; platform: string }[] }> {
  const launchAssetKey = await uploadAsset(opts.bundle ?? `bundle-${crypto.randomUUID()}`, "application/javascript", ".bundle");
  const imageKey = await uploadAsset("png-bytes", "image/png", ".png");
  const res = await adminCall("/updates", {
    method: "POST",
    json: {
      channel: opts.channel ?? "production",
      message: opts.message ?? "test",
      rolloutPct: opts.rolloutPct ?? 100,
      updates: (opts.platforms ?? ["android"]).map((platform) => ({
        platform,
        runtimeVersion: opts.runtimeVersion ?? "rt-1",
        launchAssetKey,
        assetKeys: [imageKey],
        extra: { expoClient: { name: "Example App", slug: "example-app" } },
      })),
    },
  });
  if (res.status !== 201) throw new Error(`publish failed ${res.status}: ${await res.text()}`);
  return res.json();
}

export const uniqueChannel = () => `ch-${crypto.randomUUID().slice(0, 8)}`;
