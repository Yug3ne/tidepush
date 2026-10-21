import { useEffect, useId, useState } from "react";
import { errorMessage, type Update } from "../lib/api";
import { CHANNEL_RE } from "../lib/config";
import { TextField } from "../components/Field";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { platformLabel, shortId } from "../lib/format";
import { useAdminApi } from "../lib/scope";

export type Scope = "update" | "group";

/** The ids sent to the API: one platform's update, or the whole publish (group). */
const targetId = (u: Update, scope: Scope) => (scope === "group" ? u.groupId : u.id);

function ScopeField({ update, siblings, scope, onChange }: { update: Update; siblings: Update[]; scope: Scope; onChange: (s: Scope) => void }) {
  const name = useId();
  if (siblings.length === 0) return null;
  const platforms = [update, ...siblings].map((u) => platformLabel(u.platform)).join(" + ");
  return (
    <fieldset className="radio-cards">
      <legend className="field-label" style={{ marginBottom: 6 }}>
        Apply to
      </legend>
      <label className="radio-card">
        <input type="radio" name={name} checked={scope === "update"} onChange={() => onChange("update")} />
        <span>
          <strong>{platformLabel(update.platform)} only</strong>
          <span className="muted small">Just this update ({shortId(update.id)}).</span>
        </span>
      </label>
      <label className="radio-card">
        <input type="radio" name={name} checked={scope === "group"} onChange={() => onChange("group")} />
        <span>
          <strong>The whole publish ({platforms})</strong>
          <span className="muted small">Every active update published together (group {shortId(update.groupId)}).</span>
        </span>
      </label>
    </fieldset>
  );
}

function Summary({ u }: { u: Update }) {
  return (
    <dl className="summary-list">
      <dt>Update</dt>
      <dd>
        <span className="id">{u.id}</span>
      </dd>
      <dt>Message</dt>
      <dd>{u.message || <span className="muted">No message</span>}</dd>
      <dt>Where</dt>
      <dd>
        {u.channel} · {platformLabel(u.platform)} · runtime <span className="id">{u.runtimeVersion}</span>
      </dd>
    </dl>
  );
}

interface ModalBase {
  update: Update | null;
  siblings: Update[];
  onClose: () => void;
  onDone: (message: string) => void;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, reset: () => setError(null) };
}

function parsePct(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= 0 && n <= 100 ? n : null;
}

// ---- Rollout -------------------------------------------------------------------

export function RolloutModal({ update, siblings, onClose, onDone }: ModalBase) {
  const adminApi = useAdminApi();
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<Scope>("update");
  const [touched, setTouched] = useState(false);
  const action = useAction();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when a different update opens the dialog
  useEffect(() => {
    if (update) {
      setValue(String(update.rolloutPct));
      setScope("update");
      setTouched(false);
      action.reset();
    }
  }, [update]);

  const pct = parsePct(value);
  const invalid = pct === null ? "Enter a whole number from 0 to 100." : null;
  const u = update;
  const lowering = u && pct !== null && pct < u.rolloutPct;

  return (
    <Modal
      open={!!u}
      title="Change rollout"
      description="Choose the share of devices that get this update."
      onClose={onClose}
      busy={action.busy}
      onSubmit={() => {
        setTouched(true);
        if (!u || pct === null) return;
        void action.run(async () => {
          await adminApi.rollout(targetId(u, scope), pct);
          onDone(`Rollout set to ${pct}%.`);
        });
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy && <span className="spinner" aria-hidden="true" />}
            Set rollout{pct !== null ? ` to ${pct}%` : ""}
          </button>
        </>
      }
    >
      {u && (
        <>
          <Summary u={u} />
          <div className="form-row">
            <TextField
              label="Rollout (%)"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              error={touched ? invalid : null}
              hint={`Currently ${u.rolloutPct}%.`}
              autoFocus
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct ?? u.rolloutPct}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Rollout percentage"
            style={{ accentColor: "var(--accent-dark)", width: "100%" }}
          />
          <div className="page-actions" role="group" aria-label="Presets">
            {[1, 10, 25, 50, 100].map((p) => (
              <button key={p} type="button" className="btn btn-secondary btn-sm tabular" onClick={() => setValue(String(p))}>
                {p}%
              </button>
            ))}
          </div>
          <ScopeField update={u} siblings={siblings} scope={scope} onChange={setScope} />
          <p className="muted small">
            Devices are picked by a stable hash of their id, so raising the percentage keeps everyone who already has
            the update.{" "}
            {lowering
              ? "Lowering it takes the update away from some devices: they fall back to the previous update on their next check."
              : "At 0% nobody new gets it; devices that don't qualify keep the previous update."}
          </p>
          {action.error && <Notice tone="error">{action.error}</Notice>}
        </>
      )}
    </Modal>
  );
}

// ---- Promote -------------------------------------------------------------------

export function PromoteModal({ update, siblings, channels, onClose, onDone }: ModalBase & { channels: string[] }) {
  const adminApi = useAdminApi();
  const [channel, setChannel] = useState("");
  const [pct, setPct] = useState("100");
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<Scope>("update");
  const [submitted, setSubmitted] = useState(false);
  const action = useAction();
  const listId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when a different update opens the dialog
  useEffect(() => {
    if (update) {
      setChannel(update.channel === "production" ? "" : channels.includes("production") ? "production" : "");
      setPct("100");
      setMessage("");
      setScope(siblings.length ? "group" : "update");
      setSubmitted(false);
      action.reset();
    }
  }, [update]);

  const u = update;
  const c = channel.trim();
  const channelError = !c
    ? "Enter a channel."
    : !CHANNEL_RE.test(c)
      ? "Use letters, numbers, dots, dashes or underscores (up to 64)."
      : u && c === u.channel
        ? "That's the channel it's already on."
        : null;
  const pctValue = parsePct(pct);
  const pctError = pctValue === null ? "Enter a whole number from 0 to 100." : null;

  return (
    <Modal
      open={!!u}
      title="Promote update"
      description="Copy this update to another channel. The original stays where it is."
      onClose={onClose}
      busy={action.busy}
      onSubmit={() => {
        setSubmitted(true);
        if (!u || channelError || pctValue === null) return;
        void action.run(async () => {
          await adminApi.promote(targetId(u, scope), {
            channel: c,
            rolloutPct: pctValue,
            message: message.trim() || undefined,
          });
          onDone(`Promoted to ${c} at ${pctValue}%.`);
        });
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy && <span className="spinner" aria-hidden="true" />}
            Promote{c && !channelError ? ` to ${c}` : ""}
          </button>
        </>
      }
    >
      {u && (
        <>
          <Summary u={u} />
          <TextField
            label="Target channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            list={listId}
            autoComplete="off"
            spellCheck={false}
            placeholder="production"
            error={submitted ? channelError : null}
            hint="Devices whose build uses this channel name get the update."
            autoFocus
          />
          <datalist id={listId}>
            {channels
              .filter((x) => x !== u.channel)
              .map((x) => (
                <option key={x} value={x} />
              ))}
          </datalist>
          <div className="form-row">
            <TextField
              label="Rollout (%)"
              inputMode="numeric"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              error={submitted ? pctError : null}
            />
            <TextField
              label="Message (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              placeholder="Keep the original message"
            />
          </div>
          <ScopeField update={u} siblings={siblings} scope={scope} onChange={setScope} />
          {action.error && <Notice tone="error">{action.error}</Notice>}
        </>
      )}
    </Modal>
  );
}

// ---- Roll back ---------------------------------------------------------------------

export function RollbackModal({ update, siblings, onClose, onDone }: ModalBase) {
  const adminApi = useAdminApi();
  const [mode, setMode] = useState<"rollback" | "embedded">("rollback");
  const [scope, setScope] = useState<Scope>("update");
  const action = useAction();
  const name = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when a different update opens the dialog
  useEffect(() => {
    if (update) {
      setMode("rollback");
      setScope("update");
      action.reset();
    }
  }, [update]);

  const u = update;
  const where = u ? `${u.channel} (${scope === "group" ? "all platforms in this publish" : platformLabel(u.platform)}, runtime ${shortId(u.runtimeVersion, 12)})` : "";

  return (
    <Modal
      open={!!u}
      title="Roll back update"
      description="Stop serving this update. Devices change on their next app launch."
      onClose={onClose}
      busy={action.busy}
      onSubmit={() => {
        if (!u) return;
        void action.run(async () => {
          const { results } = await adminApi.rollback(targetId(u, scope), mode === "embedded");
          const republished = results.filter((r) => r.outcome === "republished").length;
          const embedded = results.filter((r) => r.outcome === "embedded").length;
          onDone(
            republished
              ? "Rolled back. The previous update was republished, so devices move to it on their next launch."
              : embedded
                ? "Rolled back. Devices return to the bundle built into the app on their next launch."
                : "Rolled back. Devices fall back to the newest remaining update.",
          );
        });
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={action.busy}>
            {action.busy && <span className="spinner" aria-hidden="true" />}
            {mode === "embedded" ? "Roll back to embedded" : "Roll back"}
          </button>
        </>
      }
    >
      {u && (
        <>
          <Summary u={u} />
          <ScopeField update={u} siblings={siblings} scope={scope} onChange={setScope} />
          <fieldset className="radio-cards">
            <legend className="field-label" style={{ marginBottom: 6 }}>
              What should devices run instead?
            </legend>
            <label className="radio-card">
              <input type="radio" name={name} checked={mode === "rollback"} onChange={() => setMode("rollback")} />
              <span>
                <strong>The previous update</strong>
                <span className="muted small">
                  Only this update is rolled back. If it's the newest one, Tidepush republishes the last fully rolled-out
                  update before it as a new update (apps only move forward, so the old one can't just be re-enabled).
                  If there's no earlier update, devices go back to the bundle built into the app.
                </span>
              </span>
            </label>
            <label className="radio-card">
              <input type="radio" name={name} checked={mode === "embedded"} onChange={() => setMode("embedded")} />
              <span>
                <strong>The bundle built into the app</strong>
                <span className="muted small">
                  Every active update on {where} is rolled back, not just this one. Devices return to the JavaScript
                  that shipped with their store build.
                </span>
              </span>
            </label>
          </fieldset>
          <Notice tone="warning" live={false}>
            This can't be undone. To serve this code again, publish or promote it again. Most devices switch within
            two app launches: one to download, one to apply.
          </Notice>
          {action.error && <Notice tone="error">{action.error}</Notice>}
        </>
      )}
    </Modal>
  );
}
