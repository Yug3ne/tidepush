import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

/** Public settings the pages need: where phones fetch updates. */
export const getPublicConfig = createServerFn({ method: "GET" }).handler(() => ({
  updatesUrl: env.UPDATES_URL.replace(/\/$/, ""),
}));
