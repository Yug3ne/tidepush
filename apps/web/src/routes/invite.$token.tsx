import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { Notice } from "../components/Notice";
import { accountApi, errorMessage } from "../lib/api";
import { viewerQuery } from "../lib/viewer";
import { getInviteInfo } from "../server/invites";

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
        <div className="form-stack">
          <Link className="btn btn-primary btn-block" to="/signup" search={{ redirect: back }}>
            Create an account
          </Link>
          <Link className="btn btn-secondary btn-block" to="/login" search={{ redirect: back }}>
            I already have an account
          </Link>
          <p className="muted small">Use {invite.email}, the address the invite was sent to.</p>
        </div>
      ) : !forYou ? (
        <Notice tone="warning">
          You're signed in as {viewer.email}. This invite is for {invite.email}: sign out, then sign in with that address.
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
