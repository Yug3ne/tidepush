import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, auth, errorMessage } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, validatePassword, focusFirstInvalid } from "../components/Field";
import { Notice } from "../components/Notice";
import { Loading } from "../components/States";
import { formatDateTime, formatRelative } from "../format";
import { useDocumentTitle, useLoad } from "../hooks";

export function InvitePage() {
  useDocumentTitle("Accept invite");
  const { token = "" } = useParams();
  const { admin: current, signedIn } = useAuth();
  const navigate = useNavigate();
  const invite = useLoad(
    () =>
      auth.invite(token).catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return null;
        throw e;
      }),
    [token],
  );

  const [form, setForm] = useState({ name: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string | null>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (invite.loading && !invite.data)
    return (
      <AuthLayout>
        <Loading label="Checking your invite…" />
      </AuthLayout>
    );

  if (invite.error)
    return (
      <AuthLayout>
        <h1>Couldn't load the invite</h1>
        <p className="lede">{invite.error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void invite.reload()}>
          Try again
        </button>
      </AuthLayout>
    );

  if (!invite.data)
    return (
      <AuthLayout>
        <h1>This invite can't be used</h1>
        <p className="lede">
          The link is invalid, has already been used, or has expired (invites last 72 hours). Ask an owner to send you
          a new one.
        </p>
        <Link to="/login" className="btn btn-secondary">
          Go to sign in
        </Link>
      </AuthLayout>
    );

  const info = invite.data;
  return (
    <AuthLayout>
      <h1>Join Tidepush</h1>
      <p className="lede">You've been invited to manage OTA updates on this server.</p>
      <dl className="summary-list" style={{ marginBottom: 20 }}>
        <dt>Email</dt>
        <dd>
          <strong>{info.email}</strong>
        </dd>
        <dt>Role</dt>
        <dd>
          <strong style={{ textTransform: "capitalize" }}>{info.role}</strong>
          <span className="muted">
            {" "}
            · {info.role === "owner" ? "full access, including the team" : "updates, rollouts and API tokens"}
          </span>
        </dd>
        <dt>Expires</dt>
        <dd title={formatDateTime(info.expiresAt)}>{formatRelative(info.expiresAt)}</dd>
      </dl>
      {current && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="info" live={false}>
            You're signed in as {current.email}. Accepting signs you in as {info.email} instead.
          </Notice>
        </div>
      )}
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next = {
            name: form.name.trim() ? null : "Enter your name.",
            password: validatePassword(form.password),
            confirm: form.confirm === form.password ? null : "The passwords don't match.",
          };
          setErrors(next);
          setError(null);
          if (Object.values(next).some(Boolean)) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          try {
            const { admin } = await auth.acceptInvite(token, { name: form.name.trim(), password: form.password });
            signedIn(admin);
            navigate("/", { replace: true });
          } catch (err) {
            setBusy(false);
            if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
              invite.setData(null);
            } else setError(errorMessage(err));
          }
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          label="Your name"
          autoComplete="name"
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={errors.name}
        />
        {/* Lets password managers save the right username. */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint="At least 12 characters."
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          error={errors.password}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          error={errors.confirm}
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
