import { CopyButton } from "../components/CopyButton";
import { PageHeader } from "../components/States";
import { useAdmin, useApps, useUpdatesUrl } from "../lib/scope";
import { CodeSigningSection } from "./CodeSigning";

/** One app: how to point an Expo app at it, and its signing keys. */
export function AppSettingsPage() {
  const { current } = useApps();
  const admin = useAdmin();
  const updatesUrl = useUpdatesUrl();
  if (!current) return null;
  const url = `${updatesUrl}/${current.id}/manifest`;
  const appJson = JSON.stringify(
    {
      expo: {
        runtimeVersion: { policy: "fingerprint" },
        updates: {
          url,
          enabled: true,
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
          requestHeaders: { "expo-channel-name": "production" },
          codeSigningCertificate: "./certs/certificate.pem",
          codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <PageHeader title={current.name} description={`App id ${current.id}`} />

      <section className="card settings-section" aria-labelledby="setup-title">
        <div className="card-header">
          <div>
            <h2 id="setup-title">Set up your Expo app</h2>
            <p>From your app's directory:</p>
          </div>
        </div>
        <div className="command">
          <code>npx tidepush login && npx tidepush init --app {current.id}</code>
          <CopyButton value={`npx tidepush login && npx tidepush init --app ${current.id}`} className="btn btn-secondary btn-sm" />
        </div>
        <p className="muted small">
          <code>init</code> saves the certificate to <code>certs/certificate.pem</code> and writes these settings into{" "}
          <code>app.json</code>:
        </p>
        <dl className="kv">
          <dt>Update URL</dt>
          <dd>
            <code>{url}</code> <CopyButton value={url} className="btn btn-ghost btn-sm" />
          </dd>
        </dl>
        <details className="disclosure">
          <summary>Show the app.json settings</summary>
          <pre>{appJson}</pre>
        </details>
        <p className="muted small">
          Then make a release build, and publish after it: <code>npx tidepush publish --channel production</code>.
        </p>
      </section>

      <CodeSigningSection isOwner={admin.role === "owner"} />
    </>
  );
}
