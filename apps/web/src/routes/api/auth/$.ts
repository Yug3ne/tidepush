import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "../../../server/auth";

/** Better Auth's endpoints: sign-in, sign-up, sessions, OAuth callbacks, device flow. */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => getAuth().handler(request),
      POST: ({ request }) => getAuth().handler(request),
    },
  },
});
