import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { appsQuery } from "../lib/queries";

/** Pages for one app. The app must belong to the org in the URL. */
export const Route = createFileRoute("/_authed/$orgId/$appId")({
  loader: async ({ context, params }) => {
    const apps = await context.queryClient.ensureQueryData(appsQuery(params.orgId));
    if (!apps.some((a) => a.id === params.appId)) throw notFound();
  },
  component: Outlet,
});
