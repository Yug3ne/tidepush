import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useParams } from "@tanstack/react-router";
import { Shell } from "../components/Shell";
import { appsQuery, configQuery, orgsQuery } from "../lib/queries";
import { ScopeProvider } from "../lib/scope";

/** Everything inside one organization, in the app shell. */
export const Route = createFileRoute("/_authed/$orgId")({
  loader: async ({ context, params }) => {
    const orgs = await context.queryClient.ensureQueryData(orgsQuery);
    if (!orgs.some((o) => o.id === params.orgId)) throw redirect({ to: "/" });
    await Promise.all([
      context.queryClient.ensureQueryData(appsQuery(params.orgId)),
      context.queryClient.ensureQueryData(configQuery),
    ]);
  },
  component: OrgLayout,
});

function OrgLayout() {
  const { orgId } = Route.useParams();
  const { viewer } = Route.useRouteContext();
  const { appId } = useParams({ strict: false });
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: apps } = useSuspenseQuery(appsQuery(orgId));
  const { data: config } = useSuspenseQuery(configQuery);
  const org = orgs.find((o) => o.id === orgId)!;
  return (
    <ScopeProvider org={org} orgs={orgs} viewer={viewer} apps={apps} appId={appId} updatesUrl={config.updatesUrl}>
      <Shell />
    </ScopeProvider>
  );
}
