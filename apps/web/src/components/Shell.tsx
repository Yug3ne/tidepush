import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { initials } from "../lib/format";
import { useAdmin, useApps, useOrg, useOrgs } from "../lib/scope";
import { Icon, type IconName } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import { ToastProvider, useToast } from "./Toast";
import { Wordmark } from "./Wordmark";

type NavItem = { to: string; label: string; icon: IconName; exact?: boolean };

function useNav(): NavItem[] {
  const org = useOrg();
  const { apps, current } = useApps();
  // Org-level pages have no app in the URL; their app links go to the first app.
  const target = current ?? apps[0];
  const app = target ? `/${org.id}/${target.id}` : null;
  return [
    ...(app
      ? ([
          { to: app, label: "Updates", icon: "updates", exact: true },
          { to: `${app}/devices`, label: "Devices", icon: "devices" },
          { to: `${app}/settings`, label: "App settings", icon: "rocket" },
        ] satisfies NavItem[])
      : []),
    { to: `/${org.id}/audit`, label: "Audit log", icon: "audit" },
    { to: `/${org.id}/settings`, label: "Settings", icon: "settings" },
  ];
}

function NavLinks() {
  return (
    <>
      {useNav().map((n) => (
        <Link
          key={n.to}
          to={n.to}
          activeOptions={{ exact: !!n.exact, includeSearch: false }}
          className="nav-link"
          activeProps={{ className: "nav-link active" }}
        >
          <Icon name={n.icon} />
          {n.label}
        </Link>
      ))}
    </>
  );
}

/** Organization and app pickers. The app picker keeps you on the same page for the other app. */
function Switchers() {
  const org = useOrg();
  const orgs = useOrgs();
  const { apps, current, select } = useApps();
  const navigate = useNavigate();
  return (
    <>
      {orgs.length > 1 && (
        <label className="app-switcher">
          <span className="app-switcher-label">Organization</span>
          <select className="select" value={org.id} onChange={(e) => void navigate({ to: `/${e.target.value}` })}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {apps.length > 1 && current && (
        <label className="app-switcher">
          <span className="app-switcher-label">App</span>
          <select className="select" value={current.id} onChange={(e) => select(e.target.value)}>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function SignOutButton({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={compact ? "icon-btn" : "btn btn-ghost btn-sm"}
      disabled={busy}
      aria-label={compact ? "Sign out" : undefined}
      title="Sign out"
      onClick={async () => {
        setBusy(true);
        const { error } = await authClient.signOut();
        if (error) toast("Couldn't reach the server to sign out. Try again.", "error");
        queryClient.clear();
        await navigate({ to: "/login" });
        setBusy(false);
      }}
    >
      <Icon name="logout" size={16} />
      {!compact && "Sign out"}
    </button>
  );
}

export function Shell() {
  const admin = useAdmin();
  const org = useOrg();
  return (
    <ToastProvider>
      <div className="app">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <aside className="sidebar" aria-label="Sidebar">
          <Wordmark to={`/${org.id}`} />
          <p className="app-switcher-label" style={{ margin: "16px 0 0" }}>
            {org.name}
          </p>
          <Switchers />
          <nav className="nav" aria-label="Main">
            <NavLinks />
          </nav>
          <div className="sidebar-footer">
            <div className="who">
              <span className="avatar" aria-hidden="true">
                {initials(admin.name)}
              </span>
              <span className="who-text">
                <span className="who-name" title={admin.email}>
                  {admin.name}
                </span>
                <span className="who-role">{admin.role}</span>
              </span>
            </div>
            <div className="sidebar-actions">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </div>
        </aside>

        <header className="topbar">
          <div className="topbar-row">
            <Wordmark to={`/${org.id}`} />
            <div className="page-actions">
              <ThemeToggle />
              <span className="avatar" title={`${admin.name} (${admin.role})`} role="img" aria-label={`Signed in as ${admin.name}, ${admin.role}`}>
                {initials(admin.name)}
              </span>
              <SignOutButton compact />
            </div>
          </div>
          <Switchers />
          <nav className="topbar-nav" aria-label="Main">
            <NavLinks />
          </nav>
        </header>

        <main id="main" className="main" tabIndex={-1}>
          <div className="main-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
