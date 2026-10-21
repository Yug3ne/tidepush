import type { PromoteResult, RollbackResult, RolloutResult, Update } from "@tidepush/api";
import { api, appPath, type ApiConfig } from "./api";

export async function promote(cfg: ApiConfig, id: string, channel: string, rolloutPct?: number) {
  const res = await api<PromoteResult>(
    cfg,
    appPath(cfg, `/updates/${encodeURIComponent(id)}/promote`),
    { method: "POST", json: { channel, ...(rolloutPct !== undefined ? { rolloutPct } : {}) } },
  );
  console.log(`✔ Promoted ${id} to ${channel} (group ${res.groupId})`);
  for (const u of res.updates) console.log(`  ${u.platform.padEnd(8)} ${u.id}`);
}

export async function rollout(cfg: ApiConfig, id: string, pct: number) {
  const res = await api<RolloutResult>(
    cfg,
    appPath(cfg, `/updates/${encodeURIComponent(id)}/rollout`),
    { method: "POST", json: { pct } },
  );
  console.log(`✔ Rollout set to ${pct}% for ${res.updates.map((u) => `${u.platform} ${u.id}`).join(", ")}`);
}

export async function rollback(cfg: ApiConfig, id: string, toEmbedded: boolean) {
  const res = await api<RollbackResult>(
    cfg,
    appPath(cfg, `/updates/${encodeURIComponent(id)}/rollback`),
    { method: "POST", json: { toEmbedded } },
  );
  for (const r of res.results) {
    const what =
      r.outcome === "republished"
        ? `previous update republished as ${r.republishedId}`
        : r.outcome === "embedded"
          ? "devices will roll back to the embedded bundle"
          : "rolled back";
    console.log(`✔ ${r.platform.padEnd(8)} ${r.id}: ${what}`);
  }
}

export async function list(
  cfg: ApiConfig,
  q: { channel?: string; platform?: string; runtimeVersion?: string; limit?: string; json: boolean },
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (typeof v === "string" && v) params.set(k, v);
  const { updates } = await api<{ updates: Update[] }>(cfg, appPath(cfg, `/updates?${params}`));
  if (q.json) {
    console.log(JSON.stringify(updates, null, 2));
    return;
  }
  if (!updates.length) {
    console.log("No updates.");
    return;
  }
  console.table(
    updates.map((u) => ({
      created: u.createdAt.replace("T", " ").slice(0, 16),
      channel: u.channel,
      platform: u.platform,
      runtime: u.runtimeVersion.slice(0, 10),
      id: u.id,
      group: u.groupId.slice(0, 8),
      rollout: `${u.rolloutPct}%`,
      status: u.status,
      devices: u.deviceCount ?? 0,
      message: (u.message ?? "").slice(0, 40),
    })),
  );
}
