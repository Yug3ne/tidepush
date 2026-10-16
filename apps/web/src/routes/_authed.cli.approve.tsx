import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AuthLayout } from "../components/AuthLayout";
import { TextField } from "../components/Field";
import { Notice } from "../components/Notice";
import { authClient } from "../lib/auth-client";

/** Approves `tidepush login` on another device (OAuth device flow). */
export const Route = createFileRoute("/_authed/cli/approve")({
  validateSearch: z.object({ user_code: z.string().optional() }),
  head: () => ({ meta: [{ title: "Approve the CLI · Tidepush" }] }),
  component: ApprovePage,
});

function ApprovePage() {
  const { user_code } = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  const [code, setCode] = useState(user_code ?? "");
  const [state, setState] = useState<"idle" | "busy" | "approved" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  const userCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  const act = async (approve: boolean) => {
    setState("busy");
    setError(null);
    const { error: failed } = approve
      ? await authClient.device.approve({ userCode })
      : await authClient.device.deny({ userCode });
    if (failed) {
      setError(failed.error_description || "That code didn't work. Check it, or run `npx tidepush login` again.");
      setState("idle");
      return;
    }
    setState(approve ? "approved" : "denied");
  };

  if (state === "approved" || state === "denied") {
    return (
      <AuthLayout>
        <h1>{state === "approved" ? "CLI approved" : "Request denied"}</h1>
        <p className="lede">
          {state === "approved" ? "Go back to your terminal; it's signed in." : "The CLI was not signed in."} You can
          close this tab.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Approve the Tidepush CLI</h1>
      <p className="lede">
        Signing the CLI in as <strong>{viewer.email}</strong>. Check that the code matches the one in your terminal.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-stack">
        <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" mono />
        <button type="button" className="btn btn-primary btn-block" disabled={state === "busy" || !userCode} onClick={() => void act(true)}>
          Approve
        </button>
        <button type="button" className="btn btn-secondary btn-block" disabled={state === "busy" || !userCode} onClick={() => void act(false)}>
          Deny
        </button>
      </div>
    </AuthLayout>
  );
}
