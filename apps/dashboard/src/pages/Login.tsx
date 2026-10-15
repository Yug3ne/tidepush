import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError, auth, errorMessage } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, validateEmail, focusFirstInvalid } from "../components/Field";
import { Notice } from "../components/Notice";
import { useDocumentTitle } from "../hooks";

function retryText(seconds: number | null) {
  if (!seconds) return "Try again in a few minutes.";
  if (seconds < 90) return `Try again in ${seconds} seconds.`;
  return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
}

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <p className="lede">Manage updates, rollouts and devices.</p>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next = { email: validateEmail(email), password: password ? null : "Enter your password." };
          setErrors(next);
          setError(null);
          if (next.email || next.password) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          try {
            const { admin } = await auth.login(email.trim().toLowerCase(), password);
            signedIn(admin);
            navigate(from, { replace: true });
          } catch (err) {
            if (err instanceof ApiError && err.status === 429) {
              setError(`Too many failed sign-in attempts. ${retryText(err.retryAfter)}`);
            } else if (err instanceof ApiError && err.status === 401) {
              setError("Invalid email or password.");
            } else {
              setError(errorMessage(err));
            }
            setBusy(false);
          }
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="muted small" style={{ marginTop: 20 }}>
        No account? Ask an owner of this Tidepush server to invite you. Forgot your password? An owner can remove
        your account and send a new invite.
      </p>
    </AuthLayout>
  );
}
