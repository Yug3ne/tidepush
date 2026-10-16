import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { forward } from "./api";

export interface InviteInfo {
  email: string;
  role: "owner" | "admin" | "member";
  orgName: string | null;
  expiresAt: string;
}

/** What an invite link is for. Public: the link itself is the secret. */
export const getInviteInfo = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().min(1).max(200) }))
  .handler(async ({ data }): Promise<InviteInfo | { error: string }> => {
    const res = await forward(null, `/auth/invites/${encodeURIComponent(data.token)}`, { method: "GET" });
    const body = (await res.json().catch(() => null)) as (InviteInfo & { error?: string }) | null;
    if (!res.ok || !body) return { error: body?.error ?? "This invite link isn't valid." };
    return body;
  });
