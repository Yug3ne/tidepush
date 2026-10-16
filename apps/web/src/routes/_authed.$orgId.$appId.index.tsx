import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createAdminApi } from "../lib/api";
import { UpdatesPage, channelsQueryKey, updatesQueryKey } from "../pages/Updates";

export const Route = createFileRoute("/_authed/$orgId/$appId/")({
  validateSearch: z.object({
    channel: z.string().optional(),
    platform: z.string().optional(),
    runtime: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  // Prefetch on the server so the list is in the first HTML.
  loader: async ({ context, params, deps }) => {
    const api = createAdminApi(params);
    await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: updatesQueryKey(params.appId, deps),
        queryFn: () =>
          api
            .updates({ channel: deps.channel, platform: deps.platform, runtimeVersion: deps.runtime, limit: 200 })
            .then((r) => r.updates),
      }),
      context.queryClient.ensureQueryData({
        queryKey: channelsQueryKey(params.appId),
        queryFn: () => api.channels().then((r) => r.channels),
      }),
    ]);
  },
  head: () => ({ meta: [{ title: "Updates · Tidepush" }] }),
  component: UpdatesPage,
});
