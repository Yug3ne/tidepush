import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAdmin, useAuth } from "../auth";
import { initials } from "../format";
import { Icon, type IconName } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import { useToast } from "./Toast";
import { Wordmark } from "./Wordmark";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Updates", icon: "updates", end: true },
  { to: "/devices", label: "Devices", icon: "devices" },
  { to: "/audit", label: "Audit log", icon: "audit" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

function NavLinks() {
  return (
    <>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          <Icon name={n.icon} />
          {n.label}
        </NavLink>
      ))}
    </>
  );
}

function SignOutButton({ compact }: { compact?: boolean }) {
  const { signOut } = useAuth();
  const toast = useToast();
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
        try {
          await signOut();
        } catch {
          toast("Signed out on this device, but the server didn't confirm.", "error");
        }
      }}
    >
      <Icon name="logout" size={16} />
      {!compact && "Sign out"}
    </button>
  );
}

export function AppShell() {
  const admin = useAdmin();
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="sidebar" aria-label="Sidebar">
        <Wordmark />
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
          <Wordmark />
          <div className="page-actions">
            <ThemeToggle />
            <span className="avatar" title={`${admin.name} (${admin.role})`} aria-label={`Signed in as ${admin.name}, ${admin.role}`} role="img">
              {initials(admin.name)}
            </span>
            <SignOutButton compact />
          </div>
        </div>
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
  );
}
