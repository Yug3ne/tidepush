import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { adminApi, errorMessage, type ApiToken, type PendingInvite, type Role, type TeamAdmin } from "../api";
import { useAdmin } from "../auth";
import { CopyButton } from "../components/CopyButton";
import { PasswordField, SelectField, TextField, validateEmail, validatePassword, focusFirstInvalid } from "../components/Field";
import { ConfirmModal, Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { Loading, PageHeader } from "../components/States";
import { useToast } from "../components/Toast";
import { ThemeToggle } from "../components/ThemeToggle";
import { formatDate, formatDateTime, formatRelative } from "../format";
import { useDocumentTitle, useLoad } from "../hooks";

export function SettingsPage() {
  useDocumentTitle("Settings");
  const admin = useAdmin();
  const isOwner = admin.role === "owner";
  const { hash } = useLocation();

  // Scroll to #tokens etc. when linked from elsewhere.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <PageHeader title="Settings" description="Your account, the team, and API tokens for the CLI and CI." />
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#account">Account</a>
          <a href="#team">Team</a>
          <a href="#tokens">API tokens</a>
        </nav>
        <div>
          <AccountSection />
          <TeamSection isOwner={isOwner} />
          <TokensSection />
        </div>
      </div>
    </>
  );
}

// ---- Account ---------------------------------------------------------------------

function AccountSection() {
  const admin = useAdmin();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  return (
    <section id="account" className="card settings-section" aria-labelledby="account-title">
      <div className="card-header">
        <div>
          <h2 id="account-title">Account</h2>
          <p>Signed in with a browser session.</p>
        </div>
      </div>
      <dl className="kv">
        <dt>Name</dt>
        <dd>{admin.name}</dd>
        <dt>Email</dt>
        <dd>{admin.email}</dd>
        <dt>Role</dt>
        <dd style={{ textTransform: "capitalize" }}>{admin.role}</dd>
        <dt>Theme</dt>
        <dd>
          <ThemeToggle />
        </dd>
      </dl>
      <hr className="divider" />
      <h3>Change password</h3>
      <form
        className="form-stack"
        style={{ marginTop: 12, maxWidth: 420 }}
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next = {
            current: form.current ? null : "Enter your current password.",
            next: validatePassword(form.next) ?? (form.next === form.current ? "Choose a different password." : null),
            confirm: form.confirm === form.next ? null : "The passwords don't match.",
          };
          setErrors(next);
          setResult(null);
          if (Object.values(next).some(Boolean)) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          try {
            await adminApi.changePassword(form.current, form.next);
            setForm({ current: "", next: "", confirm: "" });
            setResult({ tone: "success", text: "Password changed. Your other sessions were signed out." });
          } catch (err) {
            setResult({ tone: "error", text: errorMessage(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input type="email" autoComplete="username" value={admin.email} readOnly hidden />
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          value={form.current}
          onChange={(e) => setForm({ ...form, current: e.target.value })}
          error={errors.current}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint="At least 12 characters."
          value={form.next}
          onChange={(e) => setForm({ ...form, next: e.target.value })}
          error={errors.next}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          error={errors.confirm}
        />
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Change password
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- Team ------------------------------------------------------------------------

function TeamSection({ isOwner }: { isOwner: boolean }) {
  return (
    <section id="team" className="card settings-section" aria-labelledby="team-title">
      <div className="card-header">
        <div>
          <h2 id="team-title">Team</h2>
          <p>Owners manage everything, including the team. Admins manage updates, rollouts and API tokens.</p>
        </div>
      </div>
      {isOwner ? (
        <TeamManager />
      ) : (
        <Notice tone="info" live={false}>
          Only owners can see and manage the team. Ask an owner if someone needs access.
        </Notice>
      )}
    </section>
  );
}

function TeamManager() {
  const me = useAdmin();
  const toast = useToast();
  const team = useLoad(() => adminApi.team(), []);
  const [removing, setRemoving] = useState<TeamAdmin | null>(null);
  const [revoking, setRevoking] = useState<PendingInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const ownerCount = (team.data?.admins ?? []).filter((a) => a.role === "owner" && !a.disabled).length;
  const admins = (team.data?.admins ?? []).filter((a) => !a.disabled);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setModalError(null);
    try {
      await fn();
      setRemoving(null);
      setRevoking(null);
      toast(ok);
      void team.reload();
    } catch (e) {
      setModalError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {team.error && <Notice tone="error">{team.error}</Notice>}
      {!team.data ? (
        team.error ? null : <Loading label="Loading team…" />
      ) : (
        <div className="table-wrap">
          <table className="data stackable">
            <caption className="visually-hidden">Admins</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => {
                const self = a.id === me.id;
                const lastOwner = a.role === "owner" && ownerCount <= 1;
                return (
                  <tr key={a.id}>
                    <td className="cell-primary">
                      <div className="cell-stack">
                        <strong>
                          {a.name}
                          {self && <span className="muted"> (you)</span>}
                        </strong>
                        <span className="cell-meta">{a.email}</span>
                      </div>
                    </td>
                    <td data-label="Role" style={{ textTransform: "capitalize" }}>
                      {a.role}
                    </td>
                    <td data-label="Last sign-in">
                      {a.lastLoginAt ? (
                        <time dateTime={a.lastLoginAt} title={formatDateTime(a.lastLoginAt)}>
                          {formatRelative(a.lastLoginAt)}
                        </time>
                      ) : (
                        <span className="muted">Never</span>
                      )}
                    </td>
                    <td className="cell-actions" style={{ textAlign: "right" }}>
                      {!self && (
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-sm"
                          disabled={lastOwner}
                          title={lastOwner ? "The last owner can't be removed" : undefined}
                          onClick={() => {
                            setModalError(null);
                            setRemoving(a);
                          }}
                          aria-label={`Remove ${a.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {team.data && team.data.invites.length > 0 && (
        <>
          <hr className="divider" />
          <h3>Pending invites</h3>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data stackable">
              <caption className="visually-hidden">Pending invites</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Expires</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {team.data.invites.map((i) => {
                  const expired = new Date(i.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={i.email}>
                      <td className="cell-primary">{i.email}</td>
                      <td data-label="Role" style={{ textTransform: "capitalize" }}>
                        {i.role}
                      </td>
                      <td data-label="Expires">
                        <time dateTime={i.expiresAt} title={formatDateTime(i.expiresAt)}>
                          {expired ? "Expired" : formatRelative(i.expiresAt)}
                        </time>
                      </td>
                      <td className="cell-actions" style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setModalError(null);
                            setRevoking(i);
                          }}
                          aria-label={`Revoke invite for ${i.email}`}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <hr className="divider" />
      <InviteForm onInvited={() => void team.reload()} />

      <ConfirmModal
        open={!!removing}
        title="Remove admin"
        confirmLabel="Remove"
        danger
        busy={busy}
        error={modalError}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void run(() => adminApi.removeAdmin(removing.id), `${removing.name} was removed.`)}
      >
        <p>
          <strong>{removing?.name}</strong> ({removing?.email}) will be signed out everywhere and can't sign in again.
          API tokens they created keep working until you revoke them.
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={!!revoking}
        title="Revoke invite"
        confirmLabel="Revoke invite"
        danger
        busy={busy}
        error={modalError}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && void run(() => adminApi.revokeInvite(revoking.email), "Invite revoked.")}
      >
        <p>The invite link sent to {revoking?.email} will stop working.</p>
      </ConfirmModal>
    </>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; inviteUrl: string; expiresAt: string } | null>(null);

  return (
    <>
      <h3>Invite someone</h3>
      <p className="muted small" style={{ marginTop: 4 }}>
        You'll get a single-use link to send them. It's valid for 72 hours.
      </p>
      <form
        className="form-row"
        style={{ marginTop: 12 }}
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validateEmail(email);
          setFieldError(v);
          setError(null);
          if (v) return;
          setBusy(true);
          try {
            const addr = email.trim().toLowerCase();
            const r = await adminApi.invite(addr, role);
            setCreated({ email: addr, ...r });
            setEmail("");
            onInvited();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField label="Email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError} />
        <SelectField
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          options={[
            { value: "admin", label: "Admin" },
            { value: "owner", label: "Owner" },
          ]}
        />
        <button type="submit" className="btn btn-primary" style={{ minHeight: 44, alignSelf: fieldError ? "center" : "flex-end" }} disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Create invite link
        </button>
      </form>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Modal
        open={!!created}
        title="Invite link created"
        description={created ? `Send this link to ${created.email}.` : undefined}
        onClose={() => setCreated(null)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setCreated(null)}>
            Done
          </button>
        }
      >
        {created && (
          <>
            <div className="secret-box">
              <input className="input mono" readOnly value={created.inviteUrl} aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <CopyButton value={created.inviteUrl} />
            </div>
            <p className="muted small">
              Expires {formatRelative(created.expiresAt)} ({formatDateTime(created.expiresAt)}). Anyone with the link can
              use it once, so send it privately.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}

// ---- API tokens ----------------------------------------------------------------------

function TokensSection() {
  const toast = useToast();
  const tokens = useLoad(() => adminApi.tokens().then((r) => r.tokens), []);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  return (
    <section id="tokens" className="card settings-section" aria-labelledby="tokens-title">
      <div className="card-header">
        <div>
          <h2 id="tokens-title">API tokens</h2>
          <p>
            For the <code>tidepush</code> CLI and CI. Set the token as <code>TIDEPUSH_API_TOKEN</code>. Tokens act with
            full admin rights, so give each machine or pipeline its own.
          </p>
        </div>
      </div>

      {tokens.error && <Notice tone="error">{tokens.error}</Notice>}
      {!tokens.data ? (
        tokens.error ? null : <Loading label="Loading tokens…" />
      ) : tokens.data.length === 0 ? (
        <p className="muted">No API tokens yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data stackable">
            <caption className="visually-hidden">API tokens</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Token</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((t) => (
                <tr key={t.id}>
                  <td className="cell-primary">
                    <div className="cell-stack">
                      <strong>{t.name}</strong>
                      <span className="cell-meta">by {t.createdBy}</span>
                    </div>
                  </td>
                  <td data-label="Token">
                    <span className="id">tp_{t.prefix}…</span>
                  </td>
                  <td data-label="Created">
                    <time dateTime={t.createdAt} title={formatDateTime(t.createdAt)}>
                      {formatDate(t.createdAt)}
                    </time>
                  </td>
                  <td data-label="Last used">
                    {t.lastUsedAt ? (
                      <time dateTime={t.lastUsedAt} title={formatDateTime(t.lastUsedAt)}>
                        {formatRelative(t.lastUsedAt)}
                      </time>
                    ) : (
                      <span className="muted">Never</span>
                    )}
                  </td>
                  <td className="cell-actions" style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm"
                      onClick={() => {
                        setRevokeError(null);
                        setRevoking(t);
                      }}
                      aria-label={`Revoke token ${t.name}`}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr className="divider" />
      <h3>Create a token</h3>
      <form
        className="form-row"
        style={{ marginTop: 12 }}
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const n = name.trim();
          const v = !n ? "Give the token a name, e.g. github-actions." : n.length > 100 ? "Keep the name under 100 characters." : null;
          setNameError(v);
          setError(null);
          if (v) return;
          setBusy(true);
          try {
            const r = await adminApi.createToken(n);
            setCreated({ token: r.token, name: r.name });
            setName("");
            void tokens.reload();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField label="Name" placeholder="github-actions" value={name} onChange={(e) => setName(e.target.value)} error={nameError} autoComplete="off" />
        <button type="submit" className="btn btn-primary" style={{ minHeight: 44, alignSelf: nameError ? "center" : "flex-end" }} disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Create token
        </button>
      </form>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <Modal
        open={!!created}
        title="Copy your new token"
        description={created ? `Token "${created.name}" was created.` : undefined}
        onClose={() => setCreated(null)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setCreated(null)}>
            I've copied it
          </button>
        }
      >
        {created && (
          <>
            <Notice tone="warning" live={false}>
              <strong>This is the only time the token is shown.</strong> Tidepush stores just a hash, so if you lose it,
              revoke it and create a new one.
            </Notice>
            <div className="secret-box">
              <input className="input mono" readOnly value={created.token} aria-label="API token" onFocus={(e) => e.target.select()} />
              <CopyButton value={created.token} />
            </div>
            <p className="muted small">
              Use it as <code>TIDEPUSH_API_TOKEN</code> in your <code>.env</code> or as a CI secret. Never commit it.
            </p>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={!!revoking}
        title="Revoke API token"
        confirmLabel="Revoke token"
        danger
        busy={busy}
        error={revokeError}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          setBusy(true);
          setRevokeError(null);
          try {
            await adminApi.revokeToken(revoking.id);
            toast(`Token "${revoking.name}" revoked.`);
            setRevoking(null);
            void tokens.reload();
          } catch (e) {
            setRevokeError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Anything using <strong>{revoking?.name}</strong> (<span className="id">tp_{revoking?.prefix}…</span>) stops
          working immediately: CLI calls and CI jobs will get "unauthorized".
        </p>
      </ConfirmModal>
    </section>
  );
}
