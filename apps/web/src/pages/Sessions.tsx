import { Notice } from "../components/Notice";
import { Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { authClient } from "../lib/auth-client";
import { formatDate, formatRelative } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useState } from "react";

// ---- Sessions --------------------------------------------------------------------

/** Where you're signed in (browsers and the CLI), with a way to end any of them. */
export function SessionsSection() {
  const toast = useToast();
  const sessions = useLoad(["sessions"], async () => {
    const { data, error } = await authClient.listSessions();
    if (error) throw new Error(error.message ?? "Couldn't load your sessions.");
    return [...(data ?? [])].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  });
  const [busy, setBusy] = useState(false);
  const describe = (ua: string | null | undefined) => {
    if (!ua) return "Unknown device";
    if (/^Bun\/|node|undici/i.test(ua)) return "Tidepush CLI";
    const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${browser} on ${os}` : browser;
  };
  return (
    <section id="sessions" className="card settings-section" aria-labelledby="sessions-title">
      <div className="card-header">
        <div>
          <h2 id="sessions-title">Sessions</h2>
          <p>Where you're signed in, including the CLI.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await authClient.revokeOtherSessions();
            setBusy(false);
            toast(error ? "Couldn't sign out the other sessions." : "Signed out everywhere else.", error ? "error" : undefined);
            void sessions.reload();
          }}
        >
          Sign out everywhere else
        </button>
      </div>
      {sessions.error && <Notice tone="error">{sessions.error}</Notice>}
      {!sessions.data ? (
        sessions.error ? null : <Loading label="Loading sessions…" />
      ) : (
        <div className="table-wrap">
          <table className="data stackable">
            <caption className="visually-hidden">Sessions</caption>
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Last active</th>
                <th scope="col">Signed in</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((x) => (
                <tr key={x.id}>
                  <td data-label="Device">
                    {describe(x.userAgent)}
                    {x.ipAddress && <span className="muted small"> · {x.ipAddress}</span>}
                  </td>
                  <td data-label="Last active">{formatRelative(x.updatedAt)}</td>
                  <td data-label="Signed in">{formatDate(x.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await authClient.revokeSession({ token: x.token });
                        void sessions.reload();
                      }}
                    >
                      Sign out
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

