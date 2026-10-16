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
