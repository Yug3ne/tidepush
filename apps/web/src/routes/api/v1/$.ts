import { createFileRoute } from "@tanstack/react-router";
import { forward } from "../../../server/api";
import { getAuth } from "../../../server/auth";

/**
 * The admin API for the CLI after `tidepush login`: the device flow gives the
 * CLI a session token, sent as `Authorization: Bearer …`. Requests are passed
 * to the API as that person, so they get exactly that person's access.
 * (Tokens from Settings → API tokens go to the API directly instead.)
 */
async function proxy({ request, params }: { request: Request; params: { _splat?: string } }) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "Not logged in. Run `npx tidepush login`." }, { status: 401 });
  }
  const url = new URL(request.url);
  const path = `/admin/${params._splat ?? ""}${url.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return forward(session.user.id, path, { method: request.method, headers: request.headers, body: hasBody ? request.body : null });
}

export const Route = createFileRoute("/api/v1/$")({
  server: { handlers: { GET: proxy, POST: proxy, PUT: proxy, PATCH: proxy, DELETE: proxy } },
});
