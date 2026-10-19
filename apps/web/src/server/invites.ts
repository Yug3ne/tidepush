import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { account, type Result } from "./api";

export interface InviteInfo {
  email: string;
  role: "owner" | "admin" | "member";
  orgName: string | null;
  expiresAt: string;
  /** The invited email already has an account: sign in, then accept. */
  hasAccount: boolean;
}

/** What an invite link is for. Public: the link itself is the secret. */
export const getInviteInfo = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().min(1).max(200) }))
  .handler(async ({ data }): Promise<Result<InviteInfo>> => {
    const info = await account<InviteInfo>(`/invites/${encodeURIComponent(data.token)}`);
    return "error" in info ? { error: info.error || "This invite link isn't valid." } : info;
  });
