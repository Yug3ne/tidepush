import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { TextField, focusFirstInvalid, validateEmail } from "../components/Field";
import { Notice } from "../components/Notice";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password · Tidepush" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AuthLayout foot={<Link to="/login">Back to sign in</Link>}>
      <h1>Reset your password</h1>
      {sent ? (
        // The same answer whether or not the address has an account, so this page can't be used to find accounts.
        <Notice tone="success">If {email} has an account, we've sent it a link to choose a new password. It works for an hour.</Notice>
      ) : (
        <>
          <p className="lede">We'll email you a link to choose a new one.</p>
          <form
            className="form-stack"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const problem = validateEmail(email);
              setFieldError(problem);
              setError(null);
              if (problem) return focusFirstInvalid(e.currentTarget);
              setBusy(true);
              const { error: failed } = await authClient.requestPasswordReset({
                email: email.trim().toLowerCase(),
                redirectTo: "/reset-password",
              });
              setBusy(false);
              if (failed && failed.status === 429) setError("Too many attempts. Try again in a minute.");
              else setSent(true);
            }}
          >
            {error && <Notice tone="error">{error}</Notice>}
            <TextField label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError} />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              Send the link
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
