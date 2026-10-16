import { createFileRoute } from "@tanstack/react-router";
import { createAdminApi } from "../lib/api";
import { DevicesPage } from "../pages/Devices";

export const Route = createFileRoute("/_authed/$orgId/$appId/devices")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["stats", params.appId, 30],
      queryFn: () => createAdminApi(params).stats(30),
    }),
  head: () => ({ meta: [{ title: "Devices · Tidepush" }] }),
  component: DevicesPage,
});
