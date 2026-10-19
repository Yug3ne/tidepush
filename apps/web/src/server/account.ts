import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { account } from "./api";

/**
 * Creating accounts, through the API Worker's /auth routes (they answer only
 * to this app): the first owner at first-run setup, and people who accept an
 * invite without having an account. The pages then sign them in with Better
 * Auth, against the same rows. (Kept apart from invites.ts, which a route
 * loader needs, so these stay out of the initial bundle.)
 */

/** Creates the first owner. */
export const completeSetup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      setupToken: z.string().min(1).max(1024),
      name: z.string().min(1).max(100),
      email: z.string().min(1).max(254),
      password: z.string().min(1).max(256),
    }),
  )
  .handler(({ data }) => account<{ admin: { email: string } }>("/setup", { method: "POST", json: data }));

/** Creates the account for the invited email with this name and password, and joins the org. */
export const acceptInviteAsNewPerson = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(1).max(200), name: z.string().min(1).max(100), password: z.string().min(1).max(256) }))
  .handler(({ data }) =>
    account<{ orgId: string; email: string }>(`/invites/${encodeURIComponent(data.token)}/accept`, {
      method: "POST",
      json: { name: data.name, password: data.password },
    }),
  );
