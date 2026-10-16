import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { viewerQuery } from "../lib/viewer";

/**
 * Pages that need a signed-in person. This guard is navigation UX only; every
 * server function checks the session itself (see server/session.ts).
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    const viewer = await context.queryClient.ensureQueryData(viewerQuery);
    if (!viewer) throw redirect({ to: "/login", search: { redirect: location.href } });
    return { viewer };
  },
  component: Outlet,
});
