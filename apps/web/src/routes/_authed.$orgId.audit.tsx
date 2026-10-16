import { createFileRoute } from "@tanstack/react-router";
import { createAdminApi } from "../lib/api";
import { AuditPage } from "../pages/Audit";

export const Route = createFileRoute("/_authed/$orgId/audit")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["audit", params.orgId],
      queryFn: () => createAdminApi(params).audit().then((r) => r.entries),
    }),
  head: () => ({ meta: [{ title: "Audit log · Tidepush" }] }),
  component: AuditPage,
});
