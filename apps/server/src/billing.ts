import type { PlanName, UsageReport } from "@tidepush/api";
import type { Env } from "./env";
import { sendEmail } from "./email";
import { HttpError } from "./lib/http";

/**
 * Plans, until payments exist: an org is either subscribed (no limits) or on
 * the free plan. Limits only apply when the deployment runs in hosted mode.
 *
 * Phones are never affected. Going over the device limit starts a grace
 * period; after it, publishing and promoting are refused (402) until the org
 * subscribes or usage drops. Rollouts and rollbacks always work, so a bad
 * update can always be undone.
 */

export const FREE_PLAN = { monthlyActiveDevices: 1000, apps: 1, members: 3 } as const;
export const GRACE_DAYS = 7;
const GRACE_MS = GRACE_DAYS * 86_400_000;

export const isHosted = (env: Env) => env.TIDEPUSH_MODE === "hosted";

/** "YYYY-MM" in UTC: the month a device check-in counts toward. */
export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

export type { PlanName, UsageReport };

export async function usageReport(env: Env, orgId: string, now = new Date()): Promise<UsageReport> {
  const db = env.DB;
  const month = currentMonth(now);
  const [org, devices, apps, members] = await db.batch([
    db.prepare(`SELECT subscribed, over_limit_since FROM orgs WHERE id = ?`).bind(orgId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM device_months dm JOIN apps a ON a.id = dm.app_id
         WHERE a.org_id = ? AND dm.month = ?`,
      )
      .bind(orgId, month),
    db.prepare(`SELECT COUNT(*) AS n FROM apps WHERE org_id = ? AND archived_at IS NULL`).bind(orgId),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM memberships WHERE org_id = ?1)
              + (SELECT COUNT(*) FROM invites WHERE org_id = ?1 AND accepted_at IS NULL AND expires_at > ?2) AS n`,
      )
      .bind(orgId, now.toISOString()),
  ]);
  const row = org!.results[0] as { subscribed: number; over_limit_since: string | null } | undefined;
  const count = (r: D1Result | undefined) => (r?.results[0] as { n: number } | undefined)?.n ?? 0;
  const subscribed = row?.subscribed === 1;
  const plan: PlanName = !isHosted(env) ? "selfhost" : subscribed ? "subscribed" : "free";
  const limits = plan === "free" ? FREE_PLAN : null;
  const usage = { month, monthlyActiveDevices: count(devices), apps: count(apps), members: count(members) };
  const over = limits ? (["monthlyActiveDevices", "apps", "members"] as const).filter((k) => usage[k] > limits[k]) : [];
  const since = over.length ? (row?.over_limit_since ?? null) : null;
  const pausedFrom = since ? new Date(Date.parse(since) + GRACE_MS).toISOString() : null;
  return {
    plan,
    subscribed,
    limits,
    usage,
    over,
    overLimitSince: since,
    publishingPausedFrom: pausedFrom,
    publishingPaused: !!pausedFrom && Date.parse(pausedFrom) <= now.getTime(),
  };
}

/**
 * Called before publishing or promoting. Starts the grace period the first
 * time an org is seen over its limits, clears it once it's back under, and
 * refuses once the grace period has run out.
 */
export async function assertCanPublish(env: Env, orgId: string, now = new Date()): Promise<void> {
  if (!isHosted(env)) return;
  const report = await usageReport(env, orgId, now);
  const stored = await env.DB.prepare(`SELECT over_limit_since FROM orgs WHERE id = ?`)
    .bind(orgId)
    .first<{ over_limit_since: string | null }>();
  if (!report.over.length) {
    if (stored?.over_limit_since) {
      await env.DB.prepare(`UPDATE orgs SET over_limit_since = NULL WHERE id = ?`).bind(orgId).run();
    }
    return;
  }
  if (!stored?.over_limit_since) {
    const started = await env.DB.prepare(
      `UPDATE orgs SET over_limit_since = ? WHERE id = ? AND over_limit_since IS NULL`,
    )
      .bind(now.toISOString(), orgId)
      .run();
    if (started.meta.changes) await warnOwners(env, orgId, report, new Date(now.getTime() + GRACE_MS));
    return;
  }
  if (report.publishingPaused) {
    throw new HttpError(
      402,
      "Publishing is paused: this organization has been over its plan's limits for more than " +
        `${GRACE_DAYS} days. Phones still get updates. Subscribe or reduce usage to publish again.`,
    );
  }
}

export async function assertCanCreateApp(env: Env, orgId: string): Promise<void> {
  if (!isHosted(env)) return;
  const report = await usageReport(env, orgId);
  if (report.limits && report.usage.apps >= report.limits.apps) {
    throw new HttpError(402, `The free plan includes ${report.limits.apps} app. Subscribe to add more.`);
  }
}

export async function assertCanInvite(env: Env, orgId: string): Promise<void> {
  if (!isHosted(env)) return;
  const report = await usageReport(env, orgId);
  if (report.limits && report.usage.members >= report.limits.members) {
    throw new HttpError(
      402,
      `The free plan includes ${report.limits.members} members, counting pending invites. Subscribe to add more.`,
    );
  }
}

/** Emails the org's owners once, when the grace period starts. */
async function warnOwners(env: Env, orgId: string, report: UsageReport, pausesAt: Date): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT a.email, o.name FROM memberships m JOIN admins a ON a.id = m.user_id JOIN orgs o ON o.id = m.org_id
     WHERE m.org_id = ? AND m.role = 'owner' AND a.disabled_at IS NULL`,
  )
    .bind(orgId)
    .all<{ email: string; name: string }>();
  if (!results.length) return;
  const names = { monthlyActiveDevices: "monthly active devices", apps: "apps", members: "members" } as const;
  await sendEmail(env, {
    to: results.map((r) => r.email),
    subject: `${results[0]!.name} is over the free plan's limits`,
    lines: [
      `${results[0]!.name} has gone over the free plan's ${report.over.map((k) => names[k]).join(" and ")} this month.`,
      `Phones keep getting updates. Publishing pauses on ${pausesAt.toISOString().slice(0, 10)} unless you subscribe or usage drops.`,
    ],
    ...(env.WEB_URL
      ? { action: { label: "See usage", url: `${env.WEB_URL.replace(/\/$/, "")}/${orgId}/settings#billing` } }
      : {}),
  });
}
