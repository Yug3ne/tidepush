import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { api } from "./api";
import { requireViewer } from "./session";

/** What the admin API answers with: plain JSON. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const request = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  // A path under /admin. Ids and query strings only: no "..", no scheme, no host.
  path: z
    .string()
    .max(1024)
    .regex(/^\/[A-Za-z0-9_\-./?=&%:@+]*$/, "invalid path")
    .refine((p) => !p.includes(".."), "invalid path"),
  json: z.unknown().optional(),
});

/**
 * The web app's one door to the admin API: as the signed-in person, through
 * the API Worker's Internal entrypoint. Authorization is the API's: it checks
 * this person's membership and role for every org and app in the path.
 */
export const adminRequest = createServerFn({ method: "POST" })
  .validator(request)
  .middleware([requireViewer])
  .handler(({ data, context }) => api<Json>(context.viewer.id, data.path, { method: data.method, json: data.json }));
