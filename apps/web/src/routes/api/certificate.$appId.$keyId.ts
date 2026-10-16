import { createFileRoute } from "@tanstack/react-router";
import { forward } from "../../server/api";
import { getAuth } from "../../server/auth";

/** Downloads an app's certificate (public, but only for people who can see the app). */
export const Route = createFileRoute("/api/certificate/$appId/$keyId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getAuth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Sign in first", { status: 401 });
        const res = await forward(
          session.user.id,
          `/admin/apps/${encodeURIComponent(params.appId)}/keys/${encodeURIComponent(params.keyId)}/certificate`,
          { method: "GET" },
        );
        return new Response(res.body, { status: res.status, headers: res.headers });
      },
    },
  },
});
