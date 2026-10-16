import { createFileRoute, redirect } from "@tanstack/react-router";
import { orgsQuery } from "../lib/queries";

/** Home: your first organization, or onboarding if you have none yet. */
export const Route = createFileRoute("/_authed/")({
  loader: async ({ context }) => {
    const orgs = await context.queryClient.ensureQueryData(orgsQuery);
    const first = orgs[0];
    if (!first) throw redirect({ to: "/onboarding" });
    throw redirect({ to: "/$orgId", params: { orgId: first.id } });
  },
});
