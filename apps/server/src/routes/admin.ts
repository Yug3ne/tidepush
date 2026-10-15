import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireAdmin } from "../auth/middleware";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  auditStatement,
  copyUpdateStatements,
  findExistingAssetKeys,
  getUpdatesByIdOrGroup,
  type Platform,
  type UpdateRow,
} from "../db";
import type { AppEnv } from "../env";
import { bytesToBase64Url, bytesToHex, sha256 } from "../lib/encoding";
import { HttpError, parseBody, passwordSchema } from "../lib/http";
import { ASSET_KEY, r2KeyFor } from "./assets";
import team from "./team";
import tokens from "./tokens";

const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);
admin.route("/admins", team);
admin.route("/tokens", tokens);

const MAX_ASSET_BYTES = 95 * 1024 * 1024;

const channelName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "invalid channel name");
const platform = z.enum(["ios", "android"]);
const assetKey = z.string().regex(ASSET_KEY, "asset key must be hex sha256");

// ---- Account ----------------------------------------------------------------

admin.get("/me", (c) => c.json({ actor: c.get("actor"), admin: c.get("admin"), via: c.get("via") }));

/** Changes the signed-in admin's password and signs out their other sessions. */
admin.post("/me/password", async (c) => {
  const self = c.get("admin");
  const sessionHash = c.get("sessionHash");
  if (c.get("via") !== "session" || !self || !sessionHash) {
    throw new HttpError(403, "Sign in to the dashboard to change your password");
  }
  const body = await parseBody(c, z.object({ currentPassword: z.string().max(1024), newPassword: passwordSchema }));
  const db = c.env.DB;
  const row = await db.prepare(`SELECT password_hash FROM admins WHERE id = ?`).bind(self.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  await db.batch([
    db.prepare(`UPDATE admins SET password_hash = ? WHERE id = ?`).bind(await hashPassword(body.newPassword), self.id),
    db.prepare(`DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?`).bind(self.id, sessionHash),
    auditStatement(db, { actor: c.get("actor"), action: "password_change", target: self.id }),
  ]);
  return c.body(null, 204);
});

// ---- Assets ---------------------------------------------------------------

admin.post("/assets/missing", async (c) => {
  const { keys } = await parseBody(c, z.object({ keys: z.array(assetKey).max(5000) }));
  const existing = await findExistingAssetKeys(c.env.DB, [...new Set(keys)]);
  return c.json({ missing: keys.filter((k) => !existing.has(k)) });
});

admin.put("/assets/:key", async (c) => {
  const key = c.req.param("key");
  if (!ASSET_KEY.test(key)) throw new HttpError(400, "asset key must be hex sha256");
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const fileExt = c.req.header("x-file-extension") || null;
  if (fileExt && !/^\.[a-z0-9]{1,16}$/i.test(fileExt)) throw new HttpError(400, "bad x-file-extension");

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new HttpError(413, "asset too large");
  const digest = await sha256(bytes);
  if (bytesToHex(digest) !== key) throw new HttpError(400, "body does not match asset key");

  await c.env.BUCKET.put(r2KeyFor(key), bytes, { httpMetadata: { contentType } });
  await c.env.DB.prepare(
    `INSERT INTO assets (key, hash, content_type, file_ext, r2_key, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
  )
    .bind(key, bytesToBase64Url(digest), contentType, fileExt, r2KeyFor(key), bytes.byteLength, new Date().toISOString())
    .run();
  return c.json({ key, size: bytes.byteLength }, 201);
});

// ---- Publish --------------------------------------------------------------

const publishSchema = z.object({
  channel: channelName,
  message: z.string().max(1000).optional(),
  gitSha: z.string().max(64).optional(),
  rolloutPct: z.number().int().min(0).max(100).default(100),
  updates: z
    .array(
      z.object({
        platform,
        runtimeVersion: z.string().min(1).max(256),
        launchAssetKey: assetKey,
        assetKeys: z.array(assetKey).max(5000),
        metadata: z.record(z.string(), z.string()).default({}),
        extra: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1)
    .refine((u) => new Set(u.map((x) => x.platform)).size === u.length, "one update per platform"),
});

admin.post("/updates", async (c) => {
  const body = await parseBody(c, publishSchema);
  const db = c.env.DB;
  const actor = c.get("actor");

  const allKeys = [...new Set(body.updates.flatMap((u) => [u.launchAssetKey, ...u.assetKeys]))];
  const existing = await findExistingAssetKeys(db, allKeys);
  const missing = allKeys.filter((k) => !existing.has(k));
  if (missing.length) throw new HttpError(409, `missing assets: ${missing.slice(0, 5).join(", ")}…`);

  const groupId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const created: { id: string; platform: Platform; runtimeVersion: string }[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const u of body.updates) {
    const id = crypto.randomUUID();
    created.push({ id, platform: u.platform, runtimeVersion: u.runtimeVersion });
    statements.push(
      db
        .prepare(
          `INSERT INTO updates (id, group_id, channel, platform, runtime_version, created_at, message, git_sha,
             launch_asset_key, metadata_json, extra_json, rollout_pct, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        )
        .bind(
          id,
          groupId,
          body.channel,
          u.platform,
          u.runtimeVersion,
          createdAt,
          body.message ?? null,
          body.gitSha ?? null,
          u.launchAssetKey,
          JSON.stringify(u.metadata),
          JSON.stringify(u.extra),
          body.rolloutPct,
          actor,
        ),
    );
    for (const key of new Set([u.launchAssetKey, ...u.assetKeys])) {
      statements.push(
        db.prepare(`INSERT INTO update_assets (update_id, asset_key) VALUES (?, ?)`).bind(id, key),
      );
    }
  }
  statements.push(
    auditStatement(db, {
      actor,
      action: "publish",
      target: groupId,
      details: { channel: body.channel, rolloutPct: body.rolloutPct, updates: created },
    }),
  );
  await db.batch(statements);
  return c.json({ groupId, channel: body.channel, createdAt, updates: created }, 201);
});

// ---- List / detail --------------------------------------------------------

admin.get("/updates", async (c) => {
  const where: string[] = [];
  const params: string[] = [];
  for (const [col, q] of [
    ["u.channel", "channel"],
    ["u.platform", "platform"],
    ["u.runtime_version", "runtimeVersion"],
    ["u.group_id", "groupId"],
  ] as const) {
    const v = c.req.query(q);
    if (v) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT u.*,
       (SELECT COUNT(*) FROM update_assets ua WHERE ua.update_id = u.id) AS asset_count,
       (SELECT COUNT(*) FROM devices d WHERE d.current_update_id = u.id) AS device_count
     FROM updates u ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY u.created_at DESC LIMIT ${limit}`,
  )
    .bind(...params)
    .all<UpdateRow & { asset_count: number; device_count: number }>();
  return c.json({ updates: results.map(serializeUpdate) });
});

admin.get("/updates/:id", async (c) => {
  const rows = await getUpdatesByIdOrGroup(c.env.DB, c.req.param("id"));
  if (!rows.length) throw new HttpError(404, "update not found");
  return c.json({ updates: rows.map(serializeUpdate) });
});

admin.get("/channels", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT channel, platform, runtime_version,
       COUNT(*) AS update_count, MAX(created_at) AS last_published_at
     FROM updates GROUP BY channel, platform, runtime_version
     ORDER BY last_published_at DESC`,
  ).all();
  return c.json({ channels: results });
});

// ---- Promote / rollout / rollback ------------------------------------------

admin.post("/updates/:id/promote", async (c) => {
  const body = await parseBody(
    c,
    z.object({
      channel: channelName,
      rolloutPct: z.number().int().min(0).max(100).default(100),
      message: z.string().max(1000).optional(),
    }),
  );
  const sources = await activeUpdates(c, c.req.param("id"));
  const db = c.env.DB;
  const actor = c.get("actor");
  const groupId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const created = sources.map((s) => ({ id: crypto.randomUUID(), platform: s.platform, sourceId: s.id }));
  await db.batch([
    ...sources.flatMap((s, i) =>
      copyUpdateStatements(db, s, {
        id: created[i]!.id,
        groupId,
        channel: body.channel,
        createdAt,
        rolloutPct: body.rolloutPct,
        message: body.message ?? s.message,
        actor,
      }),
    ),
    auditStatement(db, {
      actor,
      action: "promote",
      target: groupId,
      details: { from: c.req.param("id"), channel: body.channel, updates: created },
    }),
  ]);
  return c.json({ groupId, channel: body.channel, updates: created }, 201);
});

admin.post("/updates/:id/rollout", async (c) => {
  const { pct } = await parseBody(c, z.object({ pct: z.number().int().min(0).max(100) }));
  const rows = await activeUpdates(c, c.req.param("id"));
  const db = c.env.DB;
  await db.batch([
    ...rows.map((r) => db.prepare(`UPDATE updates SET rollout_pct = ? WHERE id = ?`).bind(pct, r.id)),
    auditStatement(db, { actor: c.get("actor"), action: "rollout", target: c.req.param("id"), details: { pct } }),
  ]);
  return c.json({ updates: rows.map((r) => ({ id: r.id, platform: r.platform, rolloutPct: pct })) });
});

/**
 * Rolls back an update. expo-updates only moves forward in time, so if this was
 * the newest active update in its (channel, platform, runtime), the previous
 * fully rolled-out update is republished under a new id. With nothing to
 * republish, or with `toEmbedded`, every active update in the line is rolled
 * back and devices get a signed rollBackToEmbedded directive.
 */
admin.post("/updates/:id/rollback", async (c) => {
  const { toEmbedded } = await parseBody(c, z.object({ toEmbedded: z.boolean().default(false) }));
  const targets = await activeUpdates(c, c.req.param("id"));
  const db = c.env.DB;
  const actor = c.get("actor");
  const now = new Date().toISOString();
  const groupId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  const results: { id: string; platform: Platform; outcome: string; republishedId?: string }[] = [];

  for (const target of targets) {
    const { results: line } = await db
      .prepare(
        `SELECT * FROM updates WHERE channel = ? AND platform = ? AND runtime_version = ? AND status = 'active'
         ORDER BY created_at DESC`,
      )
      .bind(target.channel, target.platform, target.runtime_version)
      .all<UpdateRow>();

    const rollBack = (ids: string[]) =>
      ids.forEach((id) =>
        statements.push(
          db.prepare(`UPDATE updates SET status = 'rolled_back', rolled_back_at = ? WHERE id = ?`).bind(now, id),
        ),
      );

    if (toEmbedded) {
      rollBack(line.map((u) => u.id));
      results.push({ id: target.id, platform: target.platform, outcome: "embedded" });
      continue;
    }

    rollBack([target.id]);
    const wasNewest = line[0]?.id === target.id;
    const previous = line.find((u) => u.id !== target.id && u.created_at < target.created_at && u.rollout_pct === 100);
    if (wasNewest && previous) {
      const republishedId = crypto.randomUUID();
      statements.push(
        ...copyUpdateStatements(db, previous, {
          id: republishedId,
          groupId,
          channel: previous.channel,
          createdAt: now,
          rolloutPct: 100,
          message: `Rollback of ${target.id}: republish ${previous.id}${previous.message ? ` (${previous.message})` : ""}`,
          actor,
        }),
      );
      results.push({ id: target.id, platform: target.platform, outcome: "republished", republishedId });
    } else if (!line.some((u) => u.id !== target.id)) {
      results.push({ id: target.id, platform: target.platform, outcome: "embedded" });
    } else {
      results.push({ id: target.id, platform: target.platform, outcome: "rolled_back" });
    }
  }

  statements.push(
    auditStatement(db, { actor, action: "rollback", target: c.req.param("id"), details: { toEmbedded, results } }),
  );
  await db.batch(statements);
  return c.json({ results });
});

async function activeUpdates(c: Context<AppEnv>, id: string): Promise<UpdateRow[]> {
  const rows = (await getUpdatesByIdOrGroup(c.env.DB, id)).filter((r) => r.status === "active");
  if (!rows.length) throw new HttpError(404, "no active update with that id or group id");
  return rows;
}

// ---- Stats ----------------------------------------------------------------

admin.get("/stats", async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = c.env.DB;
  const [byRuntime, byUpdate, totals] = await db.batch([
    db
      .prepare(
        `SELECT platform, runtime_version, channel, COUNT(*) AS devices, MAX(last_seen) AS last_seen
         FROM devices WHERE last_seen >= ? GROUP BY platform, runtime_version, channel ORDER BY devices DESC`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT d.current_update_id AS update_id, d.platform, d.channel, d.runtime_version, COUNT(*) AS devices,
           (d.current_update_id = d.embedded_update_id) AS is_embedded,
           u.message, u.created_at, u.status, u.rollout_pct
         FROM devices d LEFT JOIN updates u ON u.id = d.current_update_id
         WHERE d.last_seen >= ?
         GROUP BY d.current_update_id, d.platform, d.channel, d.runtime_version
         ORDER BY devices DESC LIMIT 200`,
      )
      .bind(since),
    db
      .prepare(`SELECT platform, COUNT(*) AS devices FROM devices WHERE last_seen >= ? GROUP BY platform`)
      .bind(since),
  ]);
  return c.json({
    days,
    byRuntime: byRuntime!.results,
    byUpdate: byUpdate!.results,
    totals: totals!.results,
  });
});

admin.get("/audit", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`).all();
  return c.json({ entries: results });
});

function serializeUpdate(r: UpdateRow & { asset_count?: number; device_count?: number }) {
  return {
    id: r.id,
    groupId: r.group_id,
    channel: r.channel,
    platform: r.platform,
    runtimeVersion: r.runtime_version,
    createdAt: r.created_at,
    message: r.message,
    gitSha: r.git_sha,
    rolloutPct: r.rollout_pct,
    status: r.status,
    rolledBackAt: r.rolled_back_at,
    sourceUpdateId: r.source_update_id,
    createdBy: r.created_by,
    assetCount: r.asset_count,
    deviceCount: r.device_count,
  };
}

export default admin;
