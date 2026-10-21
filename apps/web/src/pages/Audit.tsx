import { useMemo, useState } from "react";
import type { AuditEntry } from "../lib/api";
import { SelectField } from "../components/Field";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { EmptyState, Loading, PageHeader } from "../components/States";
import { useDocumentTitle, useLoad } from "../lib/hooks";
import { useAdminApi, useOrg } from "../lib/scope";
import { LocalTime } from "../components/LocalTime";

const LABELS: Record<string, string> = {
  publish: "Published",
  promote: "Promoted",
  rollout: "Changed rollout",
  rollback: "Rolled back",
  login: "Signed in",
  logout: "Signed out",
  setup: "Set up the server",
  invite: "Invited",
  invite_revoke: "Revoked invite",
  invite_accept: "Accepted invite",
  admin_remove: "Removed admin",
  token_create: "Created API token",
  token_revoke: "Revoked API token",
  password_change: "Changed password",
};

const label = (action: string) => LABELS[action] ?? action.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

function parse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

/** One readable line for common actions; the full JSON is in the disclosure. */
function summarize(action: string, d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (action === "publish") return `to ${o.channel} at ${o.rolloutPct}%`;
  if (action === "promote") return `to ${o.channel}`;
  if (action === "rollout") return `to ${o.pct}%`;
  if (action === "rollback") return o.toEmbedded ? "to the embedded bundle" : null;
  if (action === "invite" && typeof o.role === "string") return `as ${o.role}`;
  if (action === "admin_remove" && typeof o.role === "string") return `(${o.role})`;
  if (typeof o.email === "string") return `${o.email}${typeof o.role === "string" ? ` as ${o.role}` : ""}`;
  if (typeof o.name === "string") return o.name;
  return null;
}

export function AuditPage() {
  const adminApi = useAdminApi();
  useDocumentTitle("Audit log");
  const audit = useLoad(["audit", useOrg().id], () => adminApi.audit().then((r) => r.entries));
  const [action, setAction] = useState("");
  const actions = useMemo(() => [...new Set((audit.data ?? []).map((e) => e.action))].sort(), [audit.data]);
  const entries = (audit.data ?? []).filter((e) => !action || e.action === action);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="The latest 200 changes in this organization: who did what, and when."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void audit.reload()} disabled={audit.loading}>
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        }
      />
      <div className="toolbar">
        <SelectField
          label="Action"
          className="select-sm"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          options={[{ value: "", label: "All actions" }, ...actions.map((a) => ({ value: a, label: label(a) }))]}
        />
      </div>
      {audit.error && <Notice tone="error">{audit.error}</Notice>}
      <section className="card card-flush" aria-label="Audit entries" aria-busy={audit.loading}>
        {!audit.data ? (
          audit.error ? null : <Loading label="Loading audit log…" />
        ) : entries.length === 0 ? (
          <EmptyState icon="audit" title="Nothing here yet">
            <p>Publishing, rollouts, rollbacks and account changes are recorded here.</p>
          </EmptyState>
        ) : (
          <ol className="audit-list">
            {entries.map((e) => (
              <AuditRow key={e.id} e={e} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function AuditRow({ e }: { e: AuditEntry }) {
  const details = parse(e.details_json);
  const summary = summarize(e.action, details);
  const hasDetails = details !== null && !(typeof details === "object" && Object.keys(details as object).length === 0);
  return (
    <li className="audit-item">
      <div className="audit-when">
        <LocalTime iso={e.at} />
        <LocalTime iso={e.at} mode="datetime" />
      </div>
      <div className="audit-main">
        <div className="audit-line">
          <span className="audit-actor">{e.actor}</span>
          <span className="tag">{label(e.action)}</span>
          {summary && <span className="audit-summary">{summary}</span>}
        </div>
        {e.target && (
          <div className="cell-meta">
            Target <span className="id">{e.target}</span>
          </div>
        )}
        {hasDetails && (
          <details className="disclosure">
            <summary>
              <Icon name="chevron" size={14} />
              Details
            </summary>
            <pre>
              <code>{typeof details === "string" ? details : JSON.stringify(details, null, 2)}</code>
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}
