import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { CopyButton } from "../components/CopyButton";
import { TextField, focusFirstInvalid } from "../components/Field";
import { Notice } from "../components/Notice";
import { accountApi, createAdminApi, errorMessage } from "../lib/api";
import { configQuery, orgsQuery } from "../lib/queries";
import { str, type RawSearch } from "../lib/search";

/**
 * First run: create an organization (if you have none) and its first app,
 * then the commands to connect an Expo app.
 */
export const Route = createFileRoute("/_authed/onboarding")({
  validateSearch: (s: RawSearch): { org?: string } => ({ org: str(s.org) }),
  loader: ({ context }) =>
    Promise.all([context.queryClient.ensureQueryData(orgsQuery), context.queryClient.ensureQueryData(configQuery)]),
  head: () => ({ meta: [{ title: "Get started · Tidepush" }] }),
  component: Onboarding,
});

interface CreatedApp {
  orgId: string;
  id: string;
  name: string;
  certificatePem: string | null;
}

function Onboarding() {
  const search = Route.useSearch();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: config } = useSuspenseQuery(configQuery);
  const [created, setCreated] = useState<CreatedApp | null>(null);
  const org = orgs.find((o) => o.id === search.org) ?? orgs[0];

  if (created) return <ConnectApp app={created} updatesUrl={config.updatesUrl} />;
  if (!org) return <CreateOrg />;
  return <CreateApp orgId={org.id} orgName={org.name} canCreate={org.role !== "member"} onCreated={setCreated} />;
}

function CreateOrg() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout>
      <p className="muted small">Step 1 of 2</p>
      <h1>Name your organization</h1>
      <p className="lede">
        It holds your apps and your team. Use your company or project name; you can rename it later.
      </p>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setFieldError(name.trim() ? null : "Enter a name.");
          setError(null);
          if (!name.trim()) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          try {
            await accountApi.createOrg(name.trim());
            await queryClient.invalidateQueries({ queryKey: orgsQuery.queryKey });
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          label="Organization name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError}
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Continue
        </button>
      </form>
    </AuthLayout>
  );
}

function CreateApp({
  orgId,
  orgName,
  canCreate,
  onCreated,
}: {
  orgId: string;
  orgName: string;
  canCreate: boolean;
  onCreated: (app: CreatedApp) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canCreate) {
    return (
      <AuthLayout>
        <h1>No apps yet</h1>
        <p className="lede">{orgName} has no apps yet, and your role can't create one. Ask an owner or admin.</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <p className="muted small">Step 2 of 2 · {orgName}</p>
      <h1>Add your app</h1>
      <p className="lede">One Tidepush app per Expo app. It gets its own update URL and signing key.</p>
      <form
        className="form-stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setFieldError(name.trim() ? null : "Enter the app's name.");
          setError(null);
          if (!name.trim()) return focusFirstInvalid(e.currentTarget);
          setBusy(true);
          try {
            const app = await createAdminApi({ orgId }).createApp(name.trim());
            await queryClient.invalidateQueries({ queryKey: ["apps", orgId] });
            onCreated({ orgId, id: app.id, name: app.name, certificatePem: app.signingKey?.certificatePem ?? null });
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          label="App name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError}
          placeholder="e.g. Acme Mobile"
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Create app
        </button>
      </form>
    </AuthLayout>
  );
}

function ConnectApp({ app, updatesUrl }: { app: CreatedApp; updatesUrl: string }) {
  const navigate = useNavigate();
  const command = `npx tidepush login && npx tidepush init --app ${app.id}`;
  const download = () => {
    if (!app.certificatePem) return;
    const href = URL.createObjectURL(new Blob([app.certificatePem], { type: "application/x-pem-file" }));
    const a = Object.assign(document.createElement("a"), { href, download: "certificate.pem" });
    a.click();
    URL.revokeObjectURL(href);
  };
  return (
    <AuthLayout>
      <h1>{app.name} is ready</h1>
      <p className="lede">In your Expo app's directory, run:</p>
      <div className="command">
        <code>{command}</code>
        <CopyButton value={command} className="btn btn-secondary btn-sm" />
      </div>
      <p className="muted small">
        It signs the CLI in, saves the certificate to <code>certs/certificate.pem</code> and points{" "}
        <code>updates.url</code> at <code>{`${updatesUrl}/${app.id}/manifest`}</code>. Then make a release build and
        publish after it.
      </p>
      <div className="form-stack" style={{ marginTop: 16 }}>
        {app.certificatePem && (
          <button type="button" className="btn btn-secondary btn-block" onClick={download}>
            Download the certificate instead
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void navigate({ to: "/$orgId/$appId", params: { orgId: app.orgId, appId: app.id } })}
        >
          Go to the dashboard
        </button>
        <Link
          to="/$orgId/$appId/settings"
          params={{ orgId: app.orgId, appId: app.id }}
          className="btn btn-ghost btn-block"
        >
          All setup details
        </Link>
      </div>
    </AuthLayout>
  );
}
