import { queryOptions } from "@tanstack/react-query";
import { getPublicConfig } from "../server/config";
import { getMyOrgs } from "../server/me";
import { createAdminApi } from "./api";

/** Shared by route loaders (which prefetch, on the server during SSR) and pages (which read the cache). */

export const orgsQuery = queryOptions({ queryKey: ["orgs"], queryFn: () => getMyOrgs() });

export const appsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["apps", orgId],
    queryFn: () => createAdminApi({ orgId }).apps().then((r) => r.apps.filter((a) => !a.archived)),
  });

export const configQuery = queryOptions({ queryKey: ["config"], queryFn: () => getPublicConfig(), staleTime: Infinity });

/** Updates-page filters live in the URL (?channel=&platform=&runtime=), so they survive reloads and can be shared. */
export interface UpdatesSearch {
  channel?: string;
  platform?: string;
  runtime?: string;
}

export const updatesQueryKey = (appId: string, search: UpdatesSearch) => ["updates", appId, search] as const;
export const channelsQueryKey = (appId: string) => ["channels", appId] as const;
