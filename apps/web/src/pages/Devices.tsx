import { useState } from "react";
import { BarTable } from "../components/BarTable";
import { Notice } from "../components/Notice";
import { EmptyState, Loading, PageHeader, StatusPill } from "../components/States";
import { formatCompact, formatDateTime, formatInt, formatPercent, formatRelative, platformLabel, shortId } from "../lib/format";
import { useDocumentTitle, useLoad } from "../lib/hooks";
import { useAdminApi, useApps } from "../lib/scope";

const PERIODS = [1, 7, 30, 90] as const;

export function DevicesPage() {
  const adminApi = useAdminApi();
  useDocumentTitle("Devices");
  const [days, setDays] = useState<number>(30);
  const stats = useLoad(["stats", useApps().current?.id, days], () => adminApi.stats(days));
  const s = stats.data;

  const count = (p: string) => s?.totals.find((t) => t.platform === p)?.devices ?? 0;
  const total = s?.totals.reduce((n, t) => n + t.devices, 0) ?? 0;
  const ios = count("ios");
  const android = count("android");
  const shortRuntime = (r: string) => (
    <span className="id" title={r}>
      {r.length > 14 ? `${r.slice(0, 12)}…` : r}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Devices"
        description="Devices that checked for updates in the selected period, from their latest check."
        actions={
          <div className="segmented" role="group" aria-label="Period">
            {PERIODS.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d === 1 ? "24 hours" : `${d} days`}
              </button>
            ))}
          </div>
        }
      />

      {stats.error && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="error">{stats.error}</Notice>
        </div>
      )}

      {!s ? (
        stats.error ? null : <Loading label="Loading device stats…" />
      ) : (
        <div aria-busy={stats.loading}>
          <div className="tiles">
            <Tile label="Active devices" value={total} sub={`Last ${days === 1 ? "24 hours" : `${days} days`}`} />
            <Tile label="iOS" value={ios} sub={`${formatPercent(ios, total)} of active`} />
            <Tile label="Android" value={android} sub={`${formatPercent(android, total)} of active`} />
          </div>

          {total === 0 ? (
            <section className="card section">
              <EmptyState icon="devices" title="No devices in this period">
                <p>
                  Devices show up after an app build pointing at this server checks for an update (on launch, in
                  release builds). Try a longer period, or check that the app's <code>updates.url</code> ends in{" "}
                  <code>/manifest</code>.
                </p>
              </EmptyState>
            </section>
          ) : (
            <>
              <section className="section" aria-labelledby="by-runtime">
                <div className="section-head">
                  <h2 id="by-runtime">Devices by runtime version</h2>
                  <p>A runtime is one native build. Devices on an old runtime only get new code from a store update.</p>
                </div>
                <div className="card card-flush">
                  <BarTable
                    caption="Devices by runtime version"
                    headers={["Runtime", "Platform", "Channel"]}
                    total={total}
                    rows={s.byRuntime.map((r) => ({
                      key: `${r.platform}|${r.runtime_version}|${r.channel}`,
                      title: `${formatInt(r.devices)} devices (${formatPercent(r.devices, total)}) on ${platformLabel(r.platform)} · ${r.channel} · runtime ${r.runtime_version}\nLast seen ${formatDateTime(r.last_seen)}`,
                      value: r.devices,
                      cells: [shortRuntime(r.runtime_version), platformLabel(r.platform), <span className="tag">{r.channel}</span>],
                    }))}
                  />
                </div>
              </section>

              <section className="section" aria-labelledby="by-update">
                <div className="section-head">
                  <h2 id="by-update">Adoption by update</h2>
                  <p>What each device was running the last time it checked in. "Embedded" means the bundle built into the app.</p>
                </div>
                <div className="card card-flush">
                  <BarTable
                    caption="Adoption by update"
                    headers={["Update", "Runtime", "Platform", "Channel"]}
                    total={total}
                    rows={s.byUpdate.map((r) => {
                      const embedded = !!r.is_embedded || !r.created_at;
                      return {
                        key: `${r.update_id}|${r.platform}|${r.channel}|${r.runtime_version}`,
                        title: `${formatInt(r.devices)} devices (${formatPercent(r.devices, total)})${embedded ? " on the embedded bundle" : ` on update ${r.update_id}`}${r.rollout_pct != null && !embedded ? `\nRollout ${r.rollout_pct}%` : ""}${r.created_at ? `\nPublished ${formatDateTime(r.created_at)}` : ""}`,
                        value: r.devices,
                        cells: [
                          embedded ? (
                            <span className="muted">Embedded bundle</span>
                          ) : (
                            <span className="cell-stack">
                              <span>{r.message || <span className="muted">No message</span>}</span>
                              <span className="cell-meta">
                                <span className="id">{shortId(r.update_id ?? "")}</span>
                                {r.created_at && <span>{formatRelative(r.created_at)}</span>}
                                {r.status === "rolled_back" && <StatusPill status="rolled_back" />}
                              </span>
                            </span>
                          ),
                          shortRuntime(r.runtime_version),
                          platformLabel(r.platform),
                          <span className="tag">{r.channel}</span>,
                        ],
                      };
                    })}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value" title={formatInt(value)}>
        {formatCompact(value)}
      </div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}
