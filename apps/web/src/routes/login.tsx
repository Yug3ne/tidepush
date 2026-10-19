import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, focusFirstInvalid, validateEmail } from "../components/Field";
import { GitHubButton } from "../components/GitHubButton";
import { Notice } from "../components/Notice";
import { authClient } from "../lib/auth-client";
import { configQuery } from "../lib/queries";
import { safeRedirect } from "../lib/redirect";
import { viewerQuery } from "../lib/viewer";
import { str, type RawSearch } from "../lib/search";

export const Route = createFileRoute("/login")({
  validateSearch: (s: RawSearch): { redirect?: string } => ({ redirect: str(s.redirect) }),
  beforeLoad: async ({ context, search }) => {
    if (await context.queryClient.ensureQueryData(viewerQuery)) throw redirect({ to: safeRedirect(search.redirect) });
    // A new server has nobody to sign in as yet: create the first owner.
    if ((await context.queryClient.ensureQueryData(configQuery)).needsSetup) throw redirect({ to: "/setup" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(configQuery),
  head: () => ({ meta: [{ title: "Sign in · Tidepush" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect: target } = Route.useSearch();
  const { mode } = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const to = safeRedirect(target);

  return (
    <AuthLayout
      foot={
        mode === "hosted" ? (
          <>New to Tidepush? <Link to="/signup" search={{ redirect: target }}>Create an account</Link></>
        ) : (
          <>New here? Ask an owner of this server for an invite link.</>
        )
      }
    >
      <h1>Sign in</h1>
      <p className="lede">Ship and control OTA updates for your Expo apps.</p>
      <GitHubButton callbackURL={to} label="Continue with GitHub" />
      <p className="divider-text">or with email</p>
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
          const { error: failed } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
          if (failed) {
            setError(failed.status === 429 ? "Too many attempts. Try again in a minute." : "Invalid email or password.");
            setBusy(false);
            return;
          }
          // Drop the cached "signed out" answer so the next guard asks the server again.
          queryClient.removeQueries({ queryKey: viewerQuery.queryKey });
          await navigate({ to, replace: true });
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <p className="small" style={{ margin: 0 }}>
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Sign in
        </button>
      </form>
    </AuthLayout>
  );
}
