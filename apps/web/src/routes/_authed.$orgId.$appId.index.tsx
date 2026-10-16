import { createFileRoute } from "@tanstack/react-router";
import { createAdminApi } from "../lib/api";
import { channelsQueryKey, updatesQueryKey, type UpdatesSearch } from "../lib/queries";
import { UpdatesPage } from "../pages/Updates";
import { str, type RawSearch } from "../lib/search";

export const Route = createFileRoute("/_authed/$orgId/$appId/")({
  validateSearch: (s: RawSearch): UpdatesSearch => ({ channel: str(s.channel), platform: str(s.platform), runtime: str(s.runtime) }),
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
