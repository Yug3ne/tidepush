import { useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { ApiError, auth, errorMessage } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, validateEmail, validatePassword, focusFirstInvalid } from "../components/Field";
import { Notice } from "../components/Notice";
import { useDocumentTitle } from "../hooks";

type Errors = Partial<Record<"setupToken" | "name" | "email" | "password" | "confirm", string | null>>;

export function SetupPage() {
  useDocumentTitle("Set up");
  const { signedIn, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ setupToken: "", name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthLayout>
      <h1>Set up Tidepush</h1>
      <p className="lede">Create the first owner account for this server. This screen closes for good once an owner exists.</p>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next: Errors = {
            setupToken: form.setupToken.trim() ? null : "Enter the setup token.",
            name: form.name.trim() ? null : "Enter your name.",
            email: validateEmail(form.email),
            password: validatePassword(form.password),
            confirm: form.confirm === form.password ? null : "The passwords don't match.",
          };
          setErrors(next);
          setError(null);
          if (Object.values(next).some(Boolean)) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          try {
            const { admin } = await auth.setup({
              setupToken: form.setupToken.trim(),
              name: form.name.trim(),
              email: form.email.trim().toLowerCase(),
              password: form.password,
            });
            signedIn(admin);
            navigate("/", { replace: true });
          } catch (err) {
            setBusy(false);
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
              setErrors({ ...next, setupToken: "That setup token isn't right. Check the SETUP_TOKEN secret." });
            } else if (err instanceof ApiError && err.status === 409) {
              // Someone finished setup first.
              await refresh();
              navigate("/login", { replace: true });
            } else {
              setError(errorMessage(err));
            }
          }
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <PasswordField
          label="Setup token"
          autoComplete="off"
          className="mono"
          value={form.setupToken}
          onChange={set("setupToken")}
          error={errors.setupToken}
          autoFocus
        />
        <div className="auth-help">
          <span>
            <strong>Where is the setup token?</strong> It's the <code>SETUP_TOKEN</code> secret of your Tidepush Worker,
            chosen by whoever deployed it. Set one with:
          </span>
          <pre>
            <code>openssl rand -hex 32 | npx wrangler secret put SETUP_TOKEN</code>
          </pre>
          <span>
            Locally, it lives in <code>apps/server/.dev.vars</code>.
          </span>
        </div>
        <TextField label="Your name" autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={form.email}
          onChange={set("email")}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint="At least 12 characters. A passphrase works well."
          value={form.password}
          onChange={set("password")}
          error={errors.password}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set("confirm")}
          error={errors.confirm}
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Creating account…" : "Create owner account"}
        </button>
      </form>
    </AuthLayout>
  );
}
