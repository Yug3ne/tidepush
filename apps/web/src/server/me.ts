import { createServerFn } from "@tanstack/react-start";
import { api } from "./api";
import { requireViewer } from "./session";

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
}

/** The signed-in person's organizations, from the admin API. */
export const getMyOrgs = createServerFn({ method: "GET" })
  .middleware([requireViewer])
  .handler(async ({ context }) => {
    const me = await api<{ orgs?: OrgSummary[] }>(context.viewer.id, "/me");
    return me.orgs ?? [];
  });
