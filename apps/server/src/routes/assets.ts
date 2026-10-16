import type { Context } from "hono";
import type { AppEnv } from "../env";
import { APP_ID, DEFAULT_APP_ID, r2KeyFor } from "../tenancy";

export const ASSET_KEY = /^[0-9a-f]{64}$/;

/** `GET /:appId/assets/:key`. */
export const serveAppAsset = (c: Context<AppEnv>) => serveAsset(c, c.req.param("appId") ?? "");

/** `GET /assets/:key`: files of builds made before apps existed (the default app). */
export const serveLegacyAsset = (c: Context<AppEnv>) => serveAsset(c, DEFAULT_APP_ID);

// Assets are content-addressed (key = sha256), so they never change and can be cached forever.
// Each app's files live under its own R2 prefix, so a key only resolves through the app that uploaded it.
async function serveAsset(c: Context<AppEnv>, appId: string): Promise<Response> {
  const key = c.req.param("key") ?? "";
  if (!ASSET_KEY.test(key) || !APP_ID.test(appId)) return c.notFound();

  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  const object = await c.env.BUCKET.get(r2KeyFor(appId, key));
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  const response = new Response(object.body, { headers });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
}
