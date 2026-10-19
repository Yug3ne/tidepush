import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, focusFirstInvalid, validateEmail, validatePassword } from "../components/Field";
import { Notice } from "../components/Notice";
import { authClient } from "../lib/auth-client";
import { configQuery } from "../lib/queries";
import { viewerQuery } from "../lib/viewer";
import { completeSetup } from "../server/account";

/**
 * First run on a new server: create the first owner, with the SETUP_TOKEN
 * secret set on the API Worker. Closed for good once anyone has an account.
 */
export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery({ ...configQuery, staleTime: 0 });
    if (!status.needsSetup) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Set up Tidepush" }] }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ setupToken: "", name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string | null>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthLayout>
      <h1>Set up Tidepush</h1>
      <p className="lede">Create the first owner account. You'll invite everyone else from Settings.</p>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const next = {
            setupToken: form.setupToken.trim() ? null : "Enter the setup token.",
            name: form.name.trim() ? null : "Enter your name.",
            email: validateEmail(form.email),
            password: validatePassword(form.password),
          };
          setErrors(next);
          setError(null);
          if (Object.values(next).some(Boolean)) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          const email = form.email.trim().toLowerCase();
          const created = await completeSetup({
            data: { setupToken: form.setupToken.trim(), name: form.name.trim(), email, password: form.password },
          }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
          if ("error" in created) {
            setError(created.error);
            setBusy(false);
            return;
          }
          const { error: failed } = await authClient.signIn.email({ email, password: form.password });
          queryClient.removeQueries({ queryKey: configQuery.queryKey });
          queryClient.removeQueries({ queryKey: viewerQuery.queryKey });
          await navigate({ to: failed ? "/login" : "/", replace: true });
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          label="Setup token"
          mono
          autoComplete="off"
          hint={<>The <code>SETUP_TOKEN</code> secret you set on the API Worker.</>}
          value={form.setupToken}
          onChange={set("setupToken")}
          error={errors.setupToken}
        />
        <TextField label="Your name" autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
        <TextField label="Email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} />
        <PasswordField label="Password" autoComplete="new-password" hint="At least 12 characters." value={form.password} onChange={set("password")} error={errors.password} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Create owner account
        </button>
      </form>
    </AuthLayout>
  );
}
