import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, focusFirstInvalid, validatePassword } from "../components/Field";
import { Notice } from "../components/Notice";
import { authClient } from "../lib/auth-client";
import { str, type RawSearch } from "../lib/search";

/** Where the emailed link lands: Better Auth checks the token, then redirects here with it. */
export const Route = createFileRoute("/reset-password")({
  validateSearch: (s: RawSearch): { token?: string; error?: string } => ({ token: str(s.token), error: str(s.error) }),
  head: () => ({ meta: [{ title: "Choose a new password · Tidepush" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token, error: linkError } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token || linkError) {
    return (
      <AuthLayout foot={<Link to="/forgot-password">Request a new link</Link>}>
        <h1>This link doesn't work</h1>
        <p className="lede">Reset links work once and expire after an hour.</p>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout>
        <h1>Password changed</h1>
        <p className="lede">You've been signed out everywhere. Sign in with your new password.</p>
        <Link to="/login" className="btn btn-primary btn-block">
          Sign in
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <h1>Choose a new password</h1>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next = { password: validatePassword(password), confirm: confirm === password ? null : "The passwords don't match." };
          setErrors(next);
          setError(null);
          if (next.password || next.confirm) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          const { error: failed } = await authClient.resetPassword({ newPassword: password, token });
          setBusy(false);
          if (failed) setError(failed.message ?? "That link has expired. Request a new one.");
          else setDone(true);
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <PasswordField label="New password" autoComplete="new-password" hint="At least 12 characters." value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Change password
        </button>
      </form>
    </AuthLayout>
  );
}
