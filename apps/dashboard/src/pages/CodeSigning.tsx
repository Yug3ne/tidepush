import { useState } from "react";
import { adminApi, errorMessage, type SigningKey } from "../api";
import { useApps } from "../apps";
import { CopyButton } from "../components/CopyButton";
import { PasswordField, TextField, focusFirstInvalid } from "../components/Field";
import { ConfirmModal, Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { formatDate } from "../format";
import { useLoad } from "../hooks";

const KEY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * The selected app's code-signing keys. Everyone can download certificates;
 * owners can add a key (rotation), upload their own, export and retire.
 */
export function CodeSigningSection({ isOwner }: { isOwner: boolean }) {
  const { current } = useApps();
  const toast = useToast();
  const keys = useLoad(() => adminApi.keys(), [current?.id]);
  const [exporting, setExporting] = useState<SigningKey | null>(null);
  const [retiring, setRetiring] = useState<SigningKey | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (!current) return null;
  const active = keys.data?.keys.filter((k) => !k.retired) ?? [];

  return (
    <section id="signing" className="card settings-section" aria-labelledby="signing-title">
      <div className="card-header">
        <div>
          <h2 id="signing-title">Code signing · {current.name}</h2>
          <p>
            Tidepush signs every update for this app. Put the certificate in your app as{" "}
            <code>updates.codeSigningCertificate</code>, with <code>codeSigningMetadata.keyid</code> set to its key id.
          </p>
        </div>
      </div>

      {keys.error && <Notice tone="error">{keys.error}</Notice>}
      {!keys.data ? (
        keys.error ? null : <Loading label="Loading keys…" />
      ) : (
        <>
          {keys.data.environmentKey && (
            <Notice tone="info" live={false}>
              This app also signs with the server's own key (key id <code>{keys.data.environmentKey.keyId}</code>), set
              when Tidepush was deployed. Builds made before apps existed use it.
            </Notice>
          )}
          {keys.data.keys.length === 0 ? (
            !keys.data.environmentKey && (
              <p className="muted">
                No signing key yet. {isOwner ? "Add one below." : "Ask an owner to add one."} Builds that expect a
                signature get no updates until then.
              </p>
            )
          ) : (
            <div className="table-wrap">
              <table className="data stackable">
                <caption className="visually-hidden">Signing keys</caption>
                <thead>
                  <tr>
                    <th scope="col">Key id</th>
                    <th scope="col">Fingerprint</th>
                    <th scope="col">Added</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.data.keys.map((k) => (
                    <tr key={k.keyId}>
                      <td data-label="Key id">
                        <code>{k.keyId}</code>
                        <span className="muted">
                          {" "}
                          · {k.source === "uploaded" ? "uploaded" : "generated"}
                          {k.retired && " · retired"}
                        </span>
                      </td>
                      <td data-label="Fingerprint">
                        <code title={k.fingerprint}>{k.fingerprint.slice(0, 16)}…</code>
                      </td>
                      <td data-label="Added">{formatDate(k.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <a className="btn btn-ghost btn-sm" href={adminApi.certificateUrl(k.keyId)} download="certificate.pem">
                            Certificate
                          </a>
                          {isOwner && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExporting(k)}>
                              Export key
                            </button>
                          )}
                          {isOwner && !k.retired && (
                            <button
                              type="button"
                              className="btn btn-danger-outline btn-sm"
                              onClick={() => {
                                setRetireError(null);
                                setRetiring(k);
                              }}
                            >
                              Retire
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {isOwner && (
        <>
          <hr className="divider" />
          <h3>Add a key</h3>
          <p className="muted small">
            Use a new key id to rotate: ship builds with the new certificate and key id, and retire the old key once
            those builds have replaced the old ones.
          </p>
          {keys.data && (
            <AddKeyForm
              // The server's own key id is taken too: a new key under it would cut off builds in use.
              takenIds={[...keys.data.keys.map((k) => k.keyId), ...(keys.data.environmentKey ? [keys.data.environmentKey.keyId] : [])]}
              onAdded={() => void keys.reload()}
            />
          )}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setUploading(true)}>
            Or upload your own key pair…
          </button>
        </>
      )}

      <ExportModal signingKey={exporting} onClose={() => setExporting(null)} />
      <UploadModal
        open={uploading}
        onClose={() => setUploading(false)}
        onUploaded={(keyId) => {
          setUploading(false);
          toast(`Key "${keyId}" uploaded.`, "success");
          void keys.reload();
        }}
      />
      <ConfirmModal
        open={!!retiring}
        title="Retire signing key"
        confirmLabel="Retire key"
        danger
        busy={busy}
        error={retireError}
        onClose={() => setRetiring(null)}
        onConfirm={async () => {
          if (!retiring) return;
          setBusy(true);
          try {
            await adminApi.retireKey(retiring.keyId);
            toast(`Key "${retiring.keyId}" retired.`);
            setRetiring(null);
            void keys.reload();
          } catch (e) {
            setRetireError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Tidepush stops signing with <code>{retiring?.keyId}</code>. Builds that trust only this key stop getting
          updates until people install a build with another key.
          {active.length <= 1 && !keys.data?.environmentKey && <strong> This is the app's last active key.</strong>}
        </p>
      </ConfirmModal>
    </section>
  );
}

function AddKeyForm({ takenIds, onAdded }: { takenIds: string[]; onAdded: () => void }) {
  const toast = useToast();
  const [keyId, setKeyId] = useState(takenIds.includes("main") ? "" : "main");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="form-row"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const id = keyId.trim();
        const problem = !KEY_ID.test(id)
          ? "Use letters, digits, '.', '_' or '-' (up to 64)."
          : takenIds.includes(id)
            ? "This app already has a key with that id."
            : null;
        setFieldError(problem);
        setError(null);
        if (problem) return focusFirstInvalid(e.currentTarget);
        setBusy(true);
        try {
          await adminApi.createKey(id);
          setKeyId("");
          toast(`Key "${id}" added. Download its certificate for your next build.`, "success");
          onAdded();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField label="Key id" value={keyId} onChange={(e) => setKeyId(e.target.value)} error={fieldError} placeholder="e.g. 2027" />
      <button type="submit" className="btn btn-primary" style={{ minHeight: 44, alignSelf: fieldError ? "center" : "flex-end" }} disabled={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        Generate key
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}

function ExportModal({ signingKey, onClose }: { signingKey: SigningKey | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pem, setPem] = useState<string | null>(null);
  const close = () => {
    setPassword("");
    setError(null);
    setPem(null);
    onClose();
  };

  return (
    <Modal
      open={!!signingKey}
      title={pem ? "Your private key" : "Export private key"}
      description={signingKey ? `Key "${signingKey.keyId}" of this app.` : undefined}
      onClose={close}
      busy={busy}
      onSubmit={
        pem
          ? undefined
          : async () => {
              if (!signingKey) return;
              setBusy(true);
              setError(null);
              try {
                setPem((await adminApi.exportKey(signingKey.keyId, password)).privateKeyPem);
                setPassword("");
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }
      }
      footer={
        pem ? (
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !password}>
              {busy && <span className="spinner" aria-hidden="true" />}
              Show key
            </button>
          </>
        )
      }
    >
      {pem ? (
        <>
          <Notice tone="warning" live={false}>
            <strong>Anyone with this key can sign updates your app will run.</strong> Keep it in a password manager, never
            in Git. The export is in the audit log.
          </Notice>
          <div className="secret-box">
            <textarea className="input mono" readOnly rows={6} value={pem} aria-label="Private key" onFocus={(e) => e.target.select()} />
            <CopyButton value={pem} />
          </div>
        </>
      ) : (
        <>
          <p>Enter your password to see the private key.</p>
          <PasswordField label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <Notice tone="error">{error}</Notice>}
        </>
      )}
    </Modal>
  );
}

function UploadModal({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded: (keyId: string) => void }) {
  const [form, setForm] = useState({ keyId: "", privateKeyPem: "", certificatePem: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      title="Upload a key pair"
      description="For example one made with npx expo-updates codesigning:generate."
      onClose={onClose}
      busy={busy}
      onSubmit={async () => {
        setError(null);
        if (!KEY_ID.test(form.keyId.trim())) return setError("Enter a key id: letters, digits, '.', '_' or '-'.");
        setBusy(true);
        try {
          const res = await adminApi.uploadKey({ ...form, keyId: form.keyId.trim() });
          setForm({ keyId: "", privateKeyPem: "", certificatePem: "" });
          onUploaded(res.keyId);
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Upload
          </button>
        </>
      }
    >
      <div className="form-stack">
        <TextField label="Key id" value={form.keyId} onChange={set("keyId")} placeholder="main" />
        <label className="field">
          <span className="field-label">Private key (PEM)</span>
          <textarea className="input mono" rows={5} value={form.privateKeyPem} onChange={set("privateKeyPem")} spellCheck={false} />
        </label>
        <label className="field">
          <span className="field-label">Certificate (PEM)</span>
          <textarea className="input mono" rows={5} value={form.certificatePem} onChange={set("certificatePem")} spellCheck={false} />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
