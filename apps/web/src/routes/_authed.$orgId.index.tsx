import { createFileRoute, redirect } from "@tanstack/react-router";
import { appsQuery } from "../lib/queries";

/** An org's home: its first app's updates, or creating its first app. */
export const Route = createFileRoute("/_authed/$orgId/")({
  loader: async ({ context, params }) => {
    const apps = await context.queryClient.ensureQueryData(appsQuery(params.orgId));
    const first = apps[0];
    if (!first) throw redirect({ to: "/onboarding", search: { org: params.orgId } });
    throw redirect({ to: "/$orgId/$appId", params: { orgId: params.orgId, appId: first.id } });
  },
});
