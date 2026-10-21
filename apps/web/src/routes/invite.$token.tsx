import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField, TextField, focusFirstInvalid, validatePassword } from "../components/Field";
import { Notice } from "../components/Notice";
import { accountApi, errorMessage } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { viewerQuery } from "../lib/viewer";
import { acceptInviteAsNewPerson } from "../server/account";
import { getInviteInfo, type InviteInfo } from "../server/invites";

export const Route = createFileRoute("/invite/$token")({
  loader: async ({ context, params }) => ({
    invite: await getInviteInfo({ data: { token: params.token } }),
    viewer: await context.queryClient.ensureQueryData(viewerQuery),
  }),
  head: () => ({ meta: [{ title: "Accept invite · Tidepush" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { invite, viewer } = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = `/invite/${token}`;

  if ("error" in invite) {
    return (
      <AuthLayout>
        <h1>Invite</h1>
        <Notice tone="error">{invite.error}</Notice>
        <p className="lede">Ask whoever invited you for a new link.</p>
      </AuthLayout>
    );
  }

  const forYou = viewer?.email.toLowerCase() === invite.email;
  return (
    <AuthLayout>
      <h1>Join {invite.orgName ?? "an organization"}</h1>
      <p className="lede">
        You've been invited as <strong>{invite.role}</strong>, at <strong>{invite.email}</strong>.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {!viewer ? (
        invite.hasAccount ? (
          <div className="form-stack">
            <Link className="btn btn-primary btn-block" to="/login" search={{ redirect: back }}>
              Sign in to accept
            </Link>
            <p className="muted small">
              {invite.email} already has an account. Sign in with it, and you'll come back here.
            </p>
          </div>
        ) : (
          <CreateAccount token={token} invite={invite} />
        )
      ) : !forYou ? (
        <Notice tone="warning">
          You're signed in as {viewer.email}. This invite is for {invite.email}: sign out, then sign in with that
          address.
        </Notice>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const joined = await accountApi.acceptInvite(token);
              await queryClient.invalidateQueries({ queryKey: ["orgs"] });
              await navigate({ to: "/$orgId", params: { orgId: joined.orgId } });
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          Join {invite.orgName}
        </button>
      )}
    </AuthLayout>
  );
}

/** No account for the invited email yet: choose a name and password, then you're signed in and in the org. */
function CreateAccount({ token, invite }: { token: string; invite: InviteInfo }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string | null; password?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const next = { name: name.trim() ? null : "Enter your name.", password: validatePassword(password) };
        setErrors(next);
        setError(null);
        if (next.name || next.password) return focusFirstInvalid(e.currentTarget);
        setBusy(true);
        const joined = await acceptInviteAsNewPerson({ data: { token, name: name.trim(), password } }).catch(
          (err: unknown) => ({ error: errorMessage(err) }),
        );
        if ("error" in joined) {
          setError(joined.error);
          setBusy(false);
          return;
        }
        const { error: failed } = await authClient.signIn.email({ email: invite.email, password });
        queryClient.removeQueries({ queryKey: viewerQuery.queryKey });
        if (failed) await navigate({ to: "/login", replace: true });
        else await navigate({ to: "/$orgId", params: { orgId: joined.orgId }, replace: true });
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <TextField label="Email" type="email" value={invite.email} readOnly disabled />
      <TextField
        label="Your name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <PasswordField
        label="Password"
        autoComplete="new-password"
        hint="At least 12 characters."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        Create account and join
      </button>
      <p className="muted small">
        Already have an account under another address? Ask for an invite to that one instead.
      </p>
    </form>
  );
}
