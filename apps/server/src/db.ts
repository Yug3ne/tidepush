import type { Platform } from "@tidepush/api";
import type { UpdateCandidate } from "./protocol/resolve";

export type { Platform };

export interface UpdateRow {
  id: string;
  app_id: string;
  group_id: string;
  channel: string;
  platform: Platform;
  runtime_version: string;
  created_at: string;
  message: string | null;
  git_sha: string | null;
  launch_asset_key: string;
  metadata_json: string;
  extra_json: string;
  rollout_pct: number;
  status: "active" | "rolled_back";
  rolled_back_at: string | null;
  source_update_id: string | null;
  created_by: string | null;
}

export interface AssetRow {
  app_id: string;
  key: string;
  hash: string;
  content_type: string;
  file_ext: string | null;
  r2_key: string;
  size: number;
}

export function toCandidate(row: UpdateRow): UpdateCandidate {
  return {
    id: row.id,
    createdAt: row.created_at,
    rolloutPct: row.rollout_pct,
    status: row.status,
    rolledBackAt: row.rolled_back_at,
  };
}

export async function listUpdatesFor(
  db: D1Database,
  appId: string,
  q: { channel: string; platform: string; runtimeVersion: string },
): Promise<UpdateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM updates WHERE app_id = ? AND channel = ? AND platform = ? AND runtime_version = ?
       ORDER BY created_at DESC LIMIT 200`,
    )
    .bind(appId, q.channel, q.platform, q.runtimeVersion)
    .all<UpdateRow>();
  return results;
}

export async function getUpdate(db: D1Database, id: string): Promise<UpdateRow | null> {
  return db.prepare(`SELECT * FROM updates WHERE id = ?`).bind(id).first<UpdateRow>();
}

/** Resolves an update id or a group id to the updates it names, within one app. */
export async function getUpdatesByIdOrGroup(db: D1Database, appId: string, id: string): Promise<UpdateRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM updates WHERE app_id = ?1 AND (id = ?2 OR group_id = ?2) ORDER BY platform`)
    .bind(appId, id)
    .all<UpdateRow>();
  return results;
}

export async function getUpdateAssets(
  db: D1Database,
  updateId: string,
): Promise<{ launch: AssetRow; assets: AssetRow[] }> {
  const { results } = await db
    .prepare(
      `SELECT a.*, (a.key = u.launch_asset_key) AS is_launch
       FROM update_assets ua
       JOIN updates u ON u.id = ua.update_id
       JOIN assets a ON a.app_id = u.app_id AND a.key = ua.asset_key
       WHERE ua.update_id = ?`,
    )
    .bind(updateId)
    .all<AssetRow & { is_launch: number }>();
  const launch = results.find((r) => r.is_launch);
  if (!launch) throw new Error(`Update ${updateId} has no launch asset`);
  return { launch, assets: results.filter((r) => !r.is_launch) };
}

/** D1 caps bound parameters per statement; chunk IN (...) lists. */
export async function findExistingAssetKeys(db: D1Database, appId: string, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT key FROM assets WHERE app_id = ? AND key IN (${chunk.map(() => "?").join(",")})`)
      .bind(appId, ...chunk)
      .all<{ key: string }>();
    for (const r of results) found.add(r.key);
  }
  return found;
}

/**
 * Statements that copy an update (and its asset links) under a new id. Used by
 * promote and by rollback's republish.
 */
export function copyUpdateStatements(
  db: D1Database,
  source: UpdateRow,
  copy: {
    id: string;
    groupId: string;
    channel: string;
    createdAt: string;
    rolloutPct: number;
    message: string | null;
    actor: string;
  },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO updates (id, app_id, group_id, channel, platform, runtime_version, created_at, message,
           git_sha, launch_asset_key, metadata_json, extra_json, rollout_pct, status, source_update_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(
        copy.id,
        source.app_id,
        copy.groupId,
        copy.channel,
        source.platform,
        source.runtime_version,
        copy.createdAt,
        copy.message,
        source.git_sha,
        source.launch_asset_key,
        source.metadata_json,
        source.extra_json,
        copy.rolloutPct,
        source.id,
        copy.actor,
      ),
    db
      .prepare(
        `INSERT INTO update_assets (update_id, asset_key)
         SELECT ?, asset_key FROM update_assets WHERE update_id = ?`,
      )
      .bind(copy.id, source.id),
  ];
}

/**
 * An audit log entry. `orgId` is null for events about a person rather than an
 * org (sign-in, sign-out, password change); the org's audit view includes
 * those for its members.
 */
export function auditStatement(
  db: D1Database,
  entry: {
    actor: string;
    action: string;
    orgId: string | null;
    appId?: string | null;
    target?: string;
    details?: unknown;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (at, org_id, app_id, actor, action, target, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      new Date().toISOString(),
      entry.orgId,
      entry.appId ?? null,
      entry.actor,
      entry.action,
      entry.target ?? null,
      entry.details === undefined ? null : JSON.stringify(entry.details),
    );
}
