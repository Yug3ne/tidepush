import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

/** Public settings the CLI needs (`tidepush init`): where phones fetch updates. */
export const Route = createFileRoute("/api/config")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { updatesUrl: env.UPDATES_URL.replace(/\/$/, "") },
          { headers: { "cache-control": "public, max-age=300" } },
        ),
    },
  },
});
