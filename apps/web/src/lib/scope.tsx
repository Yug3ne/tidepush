import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createAdminApi, type Admin, type AdminApi, type AppInfo, type OrgSummary } from "./api";

/**
 * What the pages inside an org work with: the org, the person's role in it,
 * its apps, the selected app (from the URL) and an API client scoped to them.
 */
interface Scope {
  org: OrgSummary;
  orgs: OrgSummary[];
  admin: Admin;
  apps: AppInfo[];
  current: AppInfo | null;
  api: AdminApi;
  /** Where phones fetch updates: an app's updates.url is `${updatesUrl}/<appId>/manifest`. */
  updatesUrl: string;
}

const ScopeContext = createContext<Scope | null>(null);

export function ScopeProvider({
  org,
  orgs,
  viewer,
  apps,
  appId,
  updatesUrl,
  children,
}: {
  org: OrgSummary;
  orgs: OrgSummary[];
  viewer: { id: string; email: string; name: string };
  apps: AppInfo[];
  appId: string | undefined;
  updatesUrl: string;
  children: ReactNode;
}) {
  const value = useMemo<Scope>(
    () => ({
      org,
      orgs,
      admin: { ...viewer, role: org.role },
      apps,
      current: apps.find((a) => a.id === appId) ?? null,
      api: createAdminApi({ orgId: org.id, appId }),
      updatesUrl,
    }),
    [org, orgs, viewer, apps, appId, updatesUrl],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("Used outside an org page");
  return scope;
}

export const useAdminApi = () => useScope().api;
export const useAdmin = () => useScope().admin;
export const useOrg = () => useScope().org;
export const useOrgs = () => useScope().orgs;
export const useUpdatesUrl = () => useScope().updatesUrl;

/** The org's apps and the one in the URL. `select` keeps the current page, for another app. */
export function useApps() {
  const { apps, current, org } = useScope();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  return {
    apps,
    current,
    select: (appId: string) => {
      const path = router.state.location.pathname;
      const rest = current ? path.slice(path.indexOf(current.id) + current.id.length) : "";
      void navigate({ to: `/${org.id}/${appId}${rest}` });
    },
    reload: () => queryClient.invalidateQueries({ queryKey: ["apps", org.id] }),
  };
}
