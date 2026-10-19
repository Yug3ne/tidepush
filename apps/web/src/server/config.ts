import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { serverStatus } from "./api";

/**
 * Public settings the pages need: where phones fetch updates, whether this is
 * the hosted service or a self-hosted server, and whether first-run setup is
 * still pending.
 */
export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => ({
  updatesUrl: env.UPDATES_URL.replace(/\/$/, ""),
  ...(await serverStatus()),
}));
