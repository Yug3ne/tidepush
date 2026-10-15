import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { adminApi, type Update } from "../api";
import { DOCS_URL } from "../config";
import { CopyButton } from "../components/CopyButton";
import { SelectField } from "../components/Field";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { EmptyState, Loading, PageHeader, RolloutMeter, StatusPill } from "../components/States";
import { useToast } from "../components/Toast";
import { formatDateTime, formatInt, formatRelative, platformLabel, shortId } from "../format";
import { useDocumentTitle, useLoad } from "../hooks";
import { PromoteModal, RollbackModal, RolloutModal } from "./updateModals";

const PUBLISH_CMD = 'bun run tidepush publish --channel staging -m "Describe the change"';

type Dialog = { kind: "rollout" | "promote" | "rollback"; update: Update } | null;

export function UpdatesPage() {
  useDocumentTitle("Updates");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filter = {
    channel: params.get("channel") ?? "",
    platform: params.get("platform") ?? "",
    runtimeVersion: params.get("runtime") ?? "",
  };
  const setFilter = (key: "channel" | "platform" | "runtime", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const updates = useLoad(
    () => adminApi.updates({ ...filter, limit: 200 }).then((r) => r.updates),
    [filter.channel, filter.platform, filter.runtimeVersion],
  );
  const channels = useLoad(() => adminApi.channels().then((r) => r.channels), []);
  const [dialog, setDialog] = useState<Dialog>(null);

  const unique = (pick: (c: { channel: string; runtime_version: string }) => string) =>
    [...new Set((channels.data ?? []).map(pick))].sort();
  const channelNames = useMemo(() => unique((c) => c.channel), [channels.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const runtimes = useMemo(() => unique((c) => c.runtime_version), [channels.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const siblingsOf = (u: Update | undefined) =>
    u ? (updates.data ?? []).filter((x) => x.groupId === u.groupId && x.id !== u.id && x.status === "active") : [];

  const filtered = !!(filter.channel || filter.platform || filter.runtimeVersion);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    toast(message);
    void updates.reload();
    void channels.reload();
  };

  return (
    <>
      <PageHeader
        title="Updates"
        description="Every update published to this server, newest first. Change rollouts, promote between channels, or roll back."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void updates.reload()} disabled={updates.loading}>
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        }
      />

      <div className="toolbar" role="search" aria-label="Filter updates">
        <SelectField
          label="Channel"
          className="select-sm"
          value={filter.channel}
          onChange={(e) => setFilter("channel", e.target.value)}
          options={[{ value: "", label: "All channels" }, ...withCurrent(channelNames, filter.channel).map((c) => ({ value: c, label: c }))]}
        />
        <SelectField
          label="Platform"
          className="select-sm"
          value={filter.platform}
          onChange={(e) => setFilter("platform", e.target.value)}
          options={[
            { value: "", label: "All platforms" },
            { value: "ios", label: "iOS" },
            { value: "android", label: "Android" },
          ]}
        />
        <SelectField
          label="Runtime"
          className="select-sm"
          value={filter.runtimeVersion}
          onChange={(e) => setFilter("runtime", e.target.value)}
          options={[
            { value: "", label: "All runtimes" },
            ...withCurrent(runtimes, filter.runtimeVersion).map((r) => ({ value: r, label: r.length > 24 ? `${r.slice(0, 20)}…` : r })),
          ]}
        />
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear filters
          </button>
        )}
        <span className="toolbar-spacer" />
        {updates.data && (
          <span className="muted small tabular" aria-live="polite">
            {formatInt(updates.data.length)} {updates.data.length === 1 ? "update" : "updates"}
          </span>
        )}
      </div>

      {updates.error && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="error">{updates.error}</Notice>
        </div>
      )}

      <section className="card card-flush" aria-label="Updates" aria-busy={updates.loading}>
        {!updates.data ? (
          updates.error ? null : <Loading label="Loading updates…" />
        ) : updates.data.length === 0 ? (
          filtered ? (
            <EmptyState icon="updates" title="No updates match these filters">
              <button type="button" className="btn btn-secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </button>
            </EmptyState>
          ) : (
            <EmptyState icon="rocket" title="No updates yet">
              <p>Publish your first update from your Expo app's repo with the Tidepush CLI. It exports the bundle, uploads only new files, and creates one update per platform.</p>
              <div className="command">
                <code>{PUBLISH_CMD}</code>
                <CopyButton value={PUBLISH_CMD} className="btn btn-secondary btn-sm" />
              </div>
              <p className="small">
                Needs <code>TIDEPUSH_SERVER_URL</code> and an API token from{" "}
                <Link to="/settings#tokens">Settings</Link>. <a href={DOCS_URL} target="_blank" rel="noreferrer">Read the docs</a>
              </p>
            </EmptyState>
          )
        ) : (
          <div className="table-wrap">
            <table className="data stackable">
              <thead>
                <tr>
                  <th scope="col">Update</th>
                  <th scope="col">Target</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Rollout
                  </th>
                  <th scope="col" className="num">
                    Devices
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {updates.data.map((u) => (
                  <UpdateRow key={u.id} u={u} onAction={(kind) => setDialog({ kind, update: u })} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RolloutModal
        update={dialog?.kind === "rollout" ? dialog.update : null}
        siblings={siblingsOf(dialog?.update)}
        onClose={close}
        onDone={done}
      />
      <PromoteModal
        update={dialog?.kind === "promote" ? dialog.update : null}
        siblings={siblingsOf(dialog?.update)}
        channels={channelNames}
        onClose={close}
        onDone={done}
      />
      <RollbackModal
        update={dialog?.kind === "rollback" ? dialog.update : null}
        siblings={siblingsOf(dialog?.update)}
        onClose={close}
        onDone={done}
      />
    </>
  );
}

function withCurrent(list: string[], current: string) {
  return current && !list.includes(current) ? [current, ...list] : list;
}

function UpdateRow({ u, onAction }: { u: Update; onAction: (kind: "rollout" | "promote" | "rollback") => void }) {
  const active = u.status === "active";
  const label = u.message || "No message";
  return (
    <tr className={active ? "" : "is-dim"}>
      <td className="cell-primary">
        <div className="cell-stack">
          <strong className="cell-title" title={label} style={{ color: u.message ? undefined : "var(--text-tertiary)" }}>
            {label}
          </strong>
          <span className="cell-meta">
            <time dateTime={u.createdAt} title={formatDateTime(u.createdAt)}>
              {formatRelative(u.createdAt)}
            </time>
            <span className="id" title={`Update ${u.id}\nGroup ${u.groupId}`}>
              {shortId(u.id)}
            </span>
            {u.gitSha && (
              <span className="id" title={`Git commit ${u.gitSha}`}>
                git {shortId(u.gitSha, 7)}
              </span>
            )}
            {u.createdBy && <span>by {u.createdBy}</span>}
            {u.sourceUpdateId && <span title={u.sourceUpdateId}>copy of <span className="id">{shortId(u.sourceUpdateId)}</span></span>}
          </span>
        </div>
      </td>
      <td data-label="Target" className="cell-target">
        <div className="cell-stack" style={{ alignItems: "inherit" }}>
          <span className="cell-meta" style={{ color: "var(--text-primary)" }}>
            <span className="tag">{u.channel}</span>
            <span>{platformLabel(u.platform)}</span>
          </span>
          <span className="id" title={`Runtime ${u.runtimeVersion}`}>
            {u.runtimeVersion.length > 14 ? `${u.runtimeVersion.slice(0, 12)}…` : u.runtimeVersion}
          </span>
        </div>
      </td>
      <td data-label="Status">
        <StatusPill status={u.status} />
      </td>
      <td className="num" data-label="Rollout">
        <RolloutMeter pct={u.rolloutPct} />
      </td>
      <td className="num" data-label="Devices">
        {formatInt(u.deviceCount ?? 0)}
      </td>
      <td className="cell-actions">
        {active ? (
          <div className="page-actions" style={{ flexWrap: "nowrap" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAction("rollout")} aria-label={`Change rollout of ${label} (${platformLabel(u.platform)}, ${u.channel})`}>
              Rollout
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAction("promote")} aria-label={`Promote ${label} (${platformLabel(u.platform)}, ${u.channel})`}>
              Promote
            </button>
            <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => onAction("rollback")} aria-label={`Roll back ${label} (${platformLabel(u.platform)}, ${u.channel})`}>
              Roll back
            </button>
          </div>
        ) : (
          <span className="muted small" title={u.rolledBackAt ? formatDateTime(u.rolledBackAt) : undefined}>
            {u.rolledBackAt ? `Rolled back ${formatRelative(u.rolledBackAt)}` : "Rolled back"}
          </span>
        )}
      </td>
    </tr>
  );
}
