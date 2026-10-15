import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} size={24} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: string | null }) {
  if (status === "active")
    return (
      <span className="pill pill-success">
        <span className="pill-dot" aria-hidden="true" />
        Active
      </span>
    );
  if (status === "rolled_back")
    return (
      <span className="pill pill-failed">
        <Icon name="undo" size={12} />
        Rolled back
      </span>
    );
  return <span className="pill pill-neutral">{status ?? "Unknown"}</span>;
}

export function RolloutMeter({ pct }: { pct: number }) {
  return (
    <span className="meter" title={`Rolled out to ${pct}% of devices`}>
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${pct}%`, display: "block" }} />
      </span>
      <span className="meter-value">{pct}%</span>
    </span>
  );
}
