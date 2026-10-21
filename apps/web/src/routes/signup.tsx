import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, focusFirstInvalid, validateEmail, validatePassword } from "../components/Field";
import { GitHubButton } from "../components/GitHubButton";
import { Notice } from "../components/Notice";
import { authClient } from "../lib/auth-client";
import { configQuery } from "../lib/queries";
import { safeRedirect } from "../lib/redirect";
import { viewerQuery } from "../lib/viewer";
import { str, type RawSearch } from "../lib/search";

export const Route = createFileRoute("/signup")({
  validateSearch: (s: RawSearch): { redirect?: string } => ({ redirect: str(s.redirect) }),
  beforeLoad: async ({ context, search }) => {
    if (await context.queryClient.ensureQueryData(viewerQuery)) throw redirect({ to: safeRedirect(search.redirect) });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(configQuery),
  head: () => ({ meta: [{ title: "Create your account · Tidepush" }] }),
  component: SignupPage,
});

function SignupPage() {
  const { redirect: target } = Route.useSearch();
  const { mode } = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string | null>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const to = safeRedirect(target);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (mode !== "hosted") {
    return (
      <AuthLayout
        foot={
          <>
            Already have an account?{" "}
            <Link to="/login" search={{ redirect: target }}>
              Sign in
            </Link>
          </>
        }
      >
        <h1>Sign-up is closed</h1>
        <p className="lede">
          This Tidepush server is invite-only. Ask one of its owners to invite you; the link they send lets you create
          your account.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      foot={
        <>
          Already have an account?{" "}
          <Link to="/login" search={{ redirect: target }}>
            Sign in
          </Link>
        </>
      }
    >
      <h1>Create your account</h1>
      <p className="lede">Free to start. No card needed.</p>
      <GitHubButton callbackURL={to} label="Sign up with GitHub" />
      <p className="divider-text">or with email</p>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next = {
            name: form.name.trim() ? null : "Enter your name.",
            email: validateEmail(form.email),
            password: validatePassword(form.password),
          };
          setErrors(next);
          setError(null);
          if (Object.values(next).some(Boolean)) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          const { error: failed } = await authClient.signUp.email({
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            password: form.password,
          });
          if (failed) {
            setError(failed.message ?? "Couldn't create the account. Try again.");
            setBusy(false);
            return;
          }
          // Drop the cached "signed out" answer so the next guard asks the server again.
          queryClient.removeQueries({ queryKey: viewerQuery.queryKey });
          await navigate({ to, replace: true });
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField label="Your name" autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={form.email}
          onChange={set("email")}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint="At least 12 characters."
          value={form.password}
          onChange={set("password")}
          error={errors.password}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Create account
        </button>
      </form>
    </AuthLayout>
  );
}
