import type { UsageReport } from "../lib/api";
import { Notice } from "../components/Notice";
import { Loading } from "../components/States";
import { formatInt } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useAdminApi, useOrg } from "../lib/scope";
import { LocalTime } from "../components/LocalTime";

const LABELS: Record<keyof NonNullable<UsageReport["limits"]>, string> = {
  monthlyActiveDevices: "Monthly active devices",
  apps: "Apps",
  members: "Members (with pending invites)",
};

const PLAN_NAMES: Record<UsageReport["plan"], string> = {
  free: "Free",
  subscribed: "Subscribed",
  selfhost: "Self-hosted",
};

export const usageQueryKey = (orgId: string) => ["usage", orgId] as const;

/** The org's plan and this month's usage. Payments aren't wired up yet: a subscription is turned on for you. */
export function BillingSection() {
  const adminApi = useAdminApi();
  const org = useOrg();
  const usage = useLoad(usageQueryKey(org.id), () => adminApi.usage());
  const report = usage.data;

  return (
    <section id="billing" className="card settings-section" aria-labelledby="billing-title">
      <div className="card-header">
        <div>
          <h2 id="billing-title">Billing</h2>
          <p>Plans are measured in monthly active devices: installs that checked for an update this month (UTC).</p>
        </div>
      </div>
      {usage.error && <Notice tone="error">{usage.error}</Notice>}
      {!report ? (
        usage.error ? null : (
          <Loading label="Loading usage…" />
        )
      ) : (
        <>
          <dl className="kv">
            <dt>Plan</dt>
            <dd>
              <strong>{PLAN_NAMES[report.plan]}</strong>
              {report.plan === "free" && <span className="muted"> · no card needed</span>}
            </dd>
            <dt>Month</dt>
            <dd>{report.usage.month}</dd>
          </dl>

          {report.publishingPaused ? (
            <Notice tone="error">
              <strong>Publishing is paused.</strong> This organization has been over its plan's limits since{" "}
              <LocalTime iso={report.overLimitSince!} mode="date" />. Phones still get updates, and rollouts and
              rollbacks still work.
            </Notice>
          ) : report.over.length ? (
            <Notice tone="warning">
              Over the free plan's limits. Publishing pauses on{" "}
              <LocalTime iso={report.publishingPausedFrom!} mode="date" /> unless you subscribe or usage drops. Phones
              keep getting updates either way.
            </Notice>
          ) : null}

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data">
              <caption className="visually-hidden">Usage this month</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Used</th>
                  <th scope="col">Included</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
                  <tr key={k}>
                    <td>{LABELS[k]}</td>
                    <td className="tabular">{formatInt(report.usage[k])}</td>
                    <td className="tabular">
                      {report.limits ? formatInt(report.limits[k]) : "Unlimited"}
                      {report.over.includes(k) && <span className="danger-text"> · over</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.plan === "free" && (
            <p className="muted small" style={{ marginTop: 12 }}>
              Online payments are coming. To subscribe now, email us from an owner's address with your organization id{" "}
              <code>{org.id}</code>.
            </p>
          )}
        </>
      )}
    </section>
  );
}
